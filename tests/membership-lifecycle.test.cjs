const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true)`);}
async function deny(db,sql,code='42501'){await db.exec('savepoint denied');try{await assert.rejects(db.exec(sql),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
async function count(db,sql){return Object.values((await db.query(sql)).rows[0])[0];}
const manage=(type,scope,user,action,role,oldRole=null,oldStatus=null)=>`select public.qb_manage_membership('${type}',(select ${scope} from qa_ids),(select ${user} from qa_ids),'${action}',${role?`'${role}'`:'null'},${oldRole?`'${oldRole}'`:'null'},${oldStatus?`'${oldStatus}'`:'null'})`;
test('Session 4 membership lifecycle role matrix',async t=>{
 const db=await database();
 async function check(name,fn){await t.test(name,async()=>{await db.exec(fixture);try{await fn();}finally{await db.exec('reset role;rollback');}});}
 try{
  await check('Org admin can grant ordinary scoped membership, suspend and reinstate with audit',async()=>{
   await actor(db);await db.exec(manage('project','project','viewer','grant','contributor'));
   await db.exec(manage('project','project','viewer','suspend',null,'contributor','active'));
   await db.exec(manage('project','project','viewer','reinstate',null,'contributor','suspended'));
   assert.equal(await count(db,`select count(*)::int from public.qb_membership_events where scope_type='project' and user_id=(select viewer from qa_ids)`),3);
   assert.equal(await count(db,`select count(*)::int from public.qb_membership_events where user_id=(select viewer from qa_ids) and actor_id=(select admin from qa_ids)`),3);
  });
  await check('Org administration supports role transfer and suspension without deleting history',async()=>{
   await actor(db);await db.exec(manage('organization','org','viewer','role','admin','member','active'));
   await db.exec(manage('organization','org','viewer','suspend',null,'admin','active'));
   await db.exec(manage('organization','org','viewer','reinstate',null,'admin','suspended'));
   assert.equal(await count(db,`select count(*)::int from public.qb_org_members where user_id=(select viewer from qa_ids)`),1);
  });
  await check('Last active admin cannot demote/suspend; failure rolls back audit and invitations',async()=>{
   await actor(db);await db.exec(manage('organization','org','reserve','role','member','admin','active'));
   const before=await count(db,'select count(*)::int from public.qb_membership_events');
   await deny(db,manage('organization','org','admin','suspend',null,'admin','active'),'23514');
   await deny(db,manage('organization','org','admin','role','member','admin','active'),'23514');
   assert.equal(await count(db,'select count(*)::int from public.qb_membership_events'),before);
  });
  await check('Last explicit department manager protected, including indirect org suspension',async()=>{
   await actor(db);await db.exec(manage('department','dept','reserve','role','contributor','manager','active'));
   await deny(db,manage('department','dept','admin','suspend',null,'manager','active'),'23514');
   await deny(db,manage('organization','org','admin','suspend',null,'admin','active'),'23514');
  });
  await check('Last restricted-project management path protected even through viewer membership',async()=>{
   await db.exec(`update public.qb_projects set visibility='restricted';update public.qb_project_members set role='viewer' where user_id=(select admin from qa_ids)`);
   await actor(db);await deny(db,manage('project','project','admin','suspend',null,'viewer','active'),'23514');
   await deny(db,manage('organization','org','admin','suspend',null,'admin','active'),'23514');
  });
  await check('Scoped suspension keeps independent department access and historical assignments',async()=>{
   await actor(db);await db.exec(manage('project','project','viewer','grant','viewer'));
   await db.exec('update public.qb_tasks set assignee_id=(select viewer from qa_ids)');
   await db.exec(manage('project','project','viewer','suspend',null,'viewer','active'));
   await actor(db,'viewer');assert.equal(await count(db,'select qb_private.can_view_project(project) from qa_ids'),true);
   await actor(db);await db.exec(manage('organization','org','viewer','suspend',null,'member','active'));
   assert.equal(await count(db,'select assignee_id=(select viewer from qa_ids) from public.qb_tasks'),true);
   await actor(db,'viewer');assert.equal(await count(db,'select qb_private.can_view_project(project) from qa_ids'),false);
  });
  await check('Reinstating org does not reactivate a suspended scope or invitation',async()=>{
   await actor(db);await db.exec(manage('department','dept','viewer','suspend',null,'viewer','active'));
   await db.exec(manage('organization','org','viewer','suspend',null,'member','active'));
   await deny(db,manage('department','dept','viewer','reinstate',null,'viewer','suspended'));
   await db.exec(manage('organization','org','viewer','reinstate',null,'member','suspended'));
   assert.equal(await count(db,`select status from public.qb_department_members where user_id=(select viewer from qa_ids)`),'suspended');
  });
  await check('Ordinary member and anonymous cannot administer or read audit',async()=>{
   await actor(db,'viewer');await deny(db,manage('organization','org','viewer','role','admin','member','active'));
   await deny(db,'select * from public.qb_membership_directory(\'department\',(select dept from qa_ids))');
   assert.equal(await count(db,'select count(*)::int from public.qb_membership_events'),0);
   await db.exec('reset role;set local role anon');await deny(db,"select public.qb_manage_membership('organization',null,null,'suspend',null)");
  });
  await check('Department manager can administer ordinary roles, not leadership or organization',async()=>{
   await db.exec(`update public.qb_org_members set role='member' where user_id=(select admin from qa_ids)`);
   await actor(db);await db.exec(manage('department','dept','viewer','role','contributor','viewer','active'));
   await deny(db,manage('department','dept','viewer','role','manager','contributor','active'));
   await deny(db,manage('department','dept','reserve','suspend',null,'manager','active'));
   assert.equal((await db.query("update public.qb_department_members set role='viewer' where user_id=(select reserve from qa_ids) returning user_id")).rows.length,0);
   await deny(db,manage('organization','org','viewer','suspend',null,'member','active'));
  });
  await check('Project-only lead can administer ordinary roles, not lead grants',async()=>{
   await db.exec(`insert into public.qb_project_members(project_id,user_id,role) select project,viewer,'lead' from qa_ids;`);
   await actor(db,'viewer');await db.exec(manage('project','project','reserve','grant','viewer'));
   await deny(db,manage('project','project','reserve','role','lead','viewer','active'));
   await deny(db,manage('project','project','admin','suspend',null,'lead','active'));
   assert.equal((await db.query("update public.qb_project_members set role='viewer' where user_id=(select admin from qa_ids) returning user_id")).rows.length,0);
  });
  await check('Hidden restricted project and cross-organization scope cannot be administered',async()=>{
   await db.exec("update public.qb_projects set visibility='restricted'");await actor(db,'reserve');
   await deny(db,manage('project','project','viewer','grant','viewer'));
   await deny(db,"select * from public.qb_membership_directory('project',(select project from qa_ids))");
   await actor(db);await deny(db,manage('department','other_dept','viewer','grant','viewer'));
  });
  await check('Stale expected state, unsupported deletion and direct org writes rejected',async()=>{
   await actor(db);await deny(db,manage('department','dept','viewer','suspend',null,'contributor','active'),'40001');
   await deny(db,manage('department','dept','viewer','remove',null,'viewer','active'),'22023');
   await deny(db,'delete from public.qb_department_members');await deny(db,"update public.qb_org_members set role='admin'");
   await deny(db,'delete from public.qb_membership_events');await deny(db,"insert into public.qb_membership_events(org_id,scope_type,scope_id,user_id) select org,'organization',org,viewer from qa_ids");
  });
  await check('Directory includes scoped suspended people but does not widen ordinary roster policies',async()=>{
   await actor(db);await db.exec(manage('department','dept','viewer','suspend',null,'viewer','active'));
   assert.equal(await count(db,"select count(*)::int from public.qb_membership_directory('department',(select dept from qa_ids)) where status='suspended'"),1);
   await actor(db,'viewer');assert.equal(await count(db,'select count(*)::int from public.qb_org_members'),1);
  });
 }finally{await db.close();}
});

test('Populated Session 3 upgrades to Session 4 without data rewrites or MeetingDesk changes',async()=>{
 const db=await database({migrate:false});const dir=__dirname+'/../supabase/migrations/';
 try{
  const files=fs.readdirSync(dir).sort();for(const f of files.filter(f=>!f.includes('session04')))await db.exec(fs.readFileSync(dir+f,'utf8'));
  await db.exec(fixture+'commit;');
  await db.exec(`create table public.meetingdesk_lifecycle_canary(id integer primary key,note text);insert into public.meetingdesk_lifecycle_canary values(1,'unchanged');alter table public.meetingdesk_lifecycle_canary enable row level security;create policy canary on public.meetingdesk_lifecycle_canary for select using(false);`);
  const snapshot=async()=>Promise.all(['qb_org_members','qb_department_members','qb_project_members','qb_tasks','meetingdesk_lifecycle_canary'].map(async table=>(await db.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows));
  const before=await snapshot();const policies=(await db.query("select * from pg_policies where tablename='meetingdesk_lifecycle_canary'")).rows;
  await db.exec(fs.readFileSync(dir+files.find(f=>f.includes('session04')),'utf8'));
  assert.deepEqual(await snapshot(),before);assert.deepEqual((await db.query("select * from pg_policies where tablename='meetingdesk_lifecycle_canary'")).rows,policies);
  assert.equal(await count(db,'select count(*)::int from public.qb_membership_events'),0);
 }finally{await db.close();}
});
