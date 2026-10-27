const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {database,applyMigrations}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];

// Assert the actual PostgreSQL error class, not simply any rejected query.
async function deny(db,sql,code){
 await db.exec('savepoint denial');
 try {await assert.rejects(()=>db.exec(sql),e=>{assert.equal(e.code,code,e.message);return true;});}
 finally {await db.exec('rollback to savepoint denial; release savepoint denial');}
}
async function actor(db,who='admin'){
 await db.exec(`reset role; set local role authenticated;
 select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);
}
async function scalar(db,sql){return Object.values((await db.query(sql)).rows[0])[0];}
const invite=`insert into public.qb_invitations(org_id,scope_type,scope_id,invite_role,invited_email,created_by)
 select org,'department',dept,'department_contributor','questboard-viewer-'||viewer||'@example.invalid',admin from qa_ids;`;
const accept=`select public.qb_accept_invitation(id) from public.qb_invitations`;
const acceptVisible=`select public.qb_accept_invitation(id) from public.qb_my_invitations()`;

 test('Session 2 permission and workflow regressions',async t=>{
 const db=await database();
 async function check(name,run){await t.test(name,async()=>{
  await db.exec(fixture);
  try {await run(db);} finally {await db.exec('reset role; rollback');}
 });}
 try {
  await check('F01: manager may create backlog; other initial states and completion timestamps denied',async db=>{
   await actor(db);
   for(const state of ['ready','in_progress','blocked','in_review','complete','cancelled'])
    await deny(db,`insert into public.qb_tasks(project_id,title,status,created_by) select project,'Injected','${state}',admin from qa_ids`,'42501');
   await deny(db,`insert into public.qb_tasks(project_id,title,completed_at,created_by) select project,'Injected',now(),admin from qa_ids`,'42501');
   await db.exec(`insert into public.qb_tasks(project_id,title,created_by) select project,'Valid',admin from qa_ids`);
   assert.equal(await scalar(db,`select status from public.qb_tasks where title='Valid'`),'backlog');
   await deny(db,`update public.qb_tasks set status='complete' where id=(select task from qa_ids)`,'42501');
  });
  await check('F01: viewer, anonymous and cross-org creation remain denied',async db=>{
   await actor(db,'viewer');
   await deny(db,`insert into public.qb_tasks(project_id,title,created_by) select project,'Denied',viewer from qa_ids`,'42501');
   await actor(db);
   await deny(db,`insert into public.qb_projects(org_id,department_id,title,created_by) select other_org,dept,'Denied',admin from qa_ids`,'42501');
   await db.exec('reset role; set local role anon');
   await deny(db,`select * from public.qb_tasks`,'42501');
   await deny(db,`select public.qb_toggle_checklist(null,true)`,'42501');
   await deny(db,`select public.qb_accept_invitation(null)`,'42501');
  });
  await check('F02: direct done/identity writes denied; open metadata and incomplete creation audited',async db=>{
   await actor(db);
   await deny(db,`update public.qb_checklist set done=true where id=(select item from qa_ids)`,'42501');
   await deny(db,`update public.qb_checklist set task_id=(select task from qa_ids) where id=(select item from qa_ids)`,'42501');
   await deny(db,`insert into public.qb_checklist(task_id,title,done) select task,'Injected',true from qa_ids`,'23514');
   await db.exec(`update public.qb_checklist set title='Renamed',position=2 where id=(select item from qa_ids);
    insert into public.qb_checklist(task_id,title) select task,'New objective' from qa_ids;
    select public.qb_toggle_checklist(item,true) from qa_ids;`);
   assert.equal(await scalar(db,`select count(*)::int from public.qb_task_events where event_type='checklist'`),3);
   assert.equal(await scalar(db,`select done from public.qb_checklist where id=(select item from qa_ids)`),true);
  });
  for(const state of ['in_review','complete','cancelled']){
   await check(`F02: ${state} objectives reject insert, metadata, direct done and RPC toggle`,async db=>{
    await db.exec(`update public.qb_tasks set status='${state}' where id=(select task from qa_ids)`);
    await actor(db);
    await deny(db,`insert into public.qb_checklist(task_id,title) select task,'Too late' from qa_ids`,'55000');
    await deny(db,`update public.qb_checklist set title='Too late' where id=(select item from qa_ids)`,'55000');
    await deny(db,`update public.qb_checklist set done=true where id=(select item from qa_ids)`,'42501');
    await deny(db,`select public.qb_toggle_checklist(item,true) from qa_ids`,'55000');
   });
  }
  await check('F02: unrelated viewer denied, assigned worker allowed, review requires objectives',async db=>{
   await actor(db,'viewer');
   await deny(db,`select public.qb_toggle_checklist(item,true) from qa_ids`,'42501');
   await db.exec(`reset role; update public.qb_tasks set assignee_id=(select viewer from qa_ids) where id=(select task from qa_ids)`);
   await actor(db,'viewer');
   await db.exec(`select public.qb_toggle_checklist(item,true) from qa_ids`);
   await actor(db);
   await db.exec(`select public.qb_transition_task(task,'ready') from qa_ids;
    select public.qb_transition_task(task,'in_progress') from qa_ids;
    select public.qb_transition_task(task,'in_review') from qa_ids;
    select public.qb_transition_task(task,'in_progress') from qa_ids;
    select public.qb_toggle_checklist(item,false) from qa_ids;`);
   await deny(db,`select public.qb_transition_task(task,'in_review') from qa_ids`,'P0001');
  });
  await check('F02: legacy review task cannot complete with incomplete objectives',async db=>{
   await db.exec(`update public.qb_tasks set status='in_review' where id=(select task from qa_ids)`);
   await actor(db);
   await deny(db,`select public.qb_transition_task(task,'complete') from qa_ids`,'P0001');
  });
  await check('F03: suspension revokes old invite permanently, including after reinstatement',async db=>{
   await db.exec(invite+`update public.qb_org_members set status='suspended' where user_id=(select viewer from qa_ids)`);
   assert.equal(await scalar(db,`select status from public.qb_invitations`),'revoked');
   const id=await scalar(db,'select id from public.qb_invitations');
   await actor(db,'viewer');
   await deny(db,`select public.qb_accept_invitation('${id}')`,'42501');
   await db.exec(`reset role; update public.qb_org_members set status='active' where user_id=(select viewer from qa_ids)`);
   await actor(db,'viewer');
   await deny(db,`select public.qb_accept_invitation('${id}')`,'42501');
  });
  await check('F03: a fresh invitation cannot restore suspended org membership',async db=>{
   await db.exec(`update public.qb_org_members set status='suspended' where user_id=(select viewer from qa_ids);`+invite);
   await actor(db,'viewer');
   await deny(db,acceptVisible,'42501');
   assert.equal(await scalar(db,`select status from public.qb_org_members where user_id=(select viewer from qa_ids)`),'suspended');
  });
  for (const [table,key,type,role] of [['qb_department_members','department_id','department','department_contributor'],['qb_project_members','project_id','project','project_contributor']]){
   await check(`F03: ${type} suspension cannot be undone by old or fresh invitations`,async db=>{
    if(type==='project') await db.exec(`insert into public.qb_project_members(project_id,user_id,role) select project,viewer,'viewer' from qa_ids`);
    const scope=type==='department'?'dept':'project';
    const ins=`insert into public.qb_invitations(org_id,scope_type,scope_id,invite_role,invited_email,created_by) select org,'${type}',${scope},'${role}','questboard-viewer-'||viewer||'@example.invalid',admin from qa_ids;`;
    await db.exec(ins+`update public.${table} set status='suspended' where user_id=(select viewer from qa_ids);`);
    assert.equal(await scalar(db,'select status from public.qb_invitations'),'revoked');
    await db.exec(ins);
    await actor(db,'viewer');
    await deny(db,acceptVisible,'42501');
    assert.equal(await scalar(db,`select status from public.${table} where user_id=(select viewer from qa_ids)`),'suspended');
   });
  }
  for(const change of ["role='member'","status='suspended'"]){
   await check(`F03: invite issuer ${change} blocks acceptance`,async db=>{
    await db.exec(invite+`update public.qb_org_members set ${change} where user_id=(select admin from qa_ids)`);
    await actor(db,'viewer');
    await deny(db,acceptVisible,'42501');
   });
  }
  await check('F03: removed issuer blocks acceptance',async db=>{
   await db.exec(invite+`delete from public.qb_org_members where user_id=(select admin from qa_ids)`);
   await actor(db,'viewer');await deny(db,acceptVisible,'42501');
  });
  await check('F03: active membership upgrades; acceptance cannot replay or downgrade',async db=>{
   await db.exec(invite); const id=await scalar(db,'select id from public.qb_invitations');
   await actor(db,'viewer');await db.exec(acceptVisible);
   assert.equal(await scalar(db,`select role from public.qb_department_members where user_id=(select viewer from qa_ids)`),'contributor');
   await deny(db,`select public.qb_accept_invitation('${id}')`,'42501');
   await db.exec('reset role;'+invite.replace('department_contributor','department_viewer'));
   await actor(db,'viewer');await db.exec(acceptVisible);
   assert.equal(await scalar(db,`select role from public.qb_department_members where user_id=(select viewer from qa_ids)`),'contributor');
  });
  for(const condition of ['wrong_email','unverified','expired','revoked','wrong_scope']){
   await check(`F03: ${condition} invite denied`,async db=>{
    await db.exec(invite);
    const id=await scalar(db,'select id from public.qb_invitations');
    const changes={wrong_email:"update public.qb_invitations set invited_email='someone-else@example.invalid'",unverified:'update auth.users set email_confirmed_at=null where id=(select viewer from qa_ids)',expired:"update public.qb_invitations set expires_at=now()-interval '1 second'",revoked:"update public.qb_invitations set status='revoked'",wrong_scope:'update public.qb_invitations set scope_id=(select other_dept from qa_ids)'};
    await db.exec(changes[condition]);await actor(db,'viewer');
    await deny(db,`select public.qb_accept_invitation('${id}')`,'42501');
   });
  }
  await check('F03: verified newcomer joins only the invited organization and scope',async db=>{
   await db.exec(`delete from public.qb_department_members where user_id=(select viewer from qa_ids);
    delete from public.qb_org_members where user_id=(select viewer from qa_ids);`+invite);
   await actor(db,'viewer');await db.exec(acceptVisible);
   assert.equal(await scalar(db,`select count(*)::int from public.qb_org_members`),1);
   assert.equal(await scalar(db,`select role from public.qb_department_members where user_id=(select viewer from qa_ids)`),'contributor');
  });
  await check('F05: dual-org admin cannot reparent department but may rename/recolor it',async db=>{
   await db.exec(`update public.qb_org_members set role='admin' where user_id=(select admin from qa_ids)`);
   await actor(db);
   await deny(db,`update public.qb_departments set org_id=(select other_org from qa_ids) where id=(select dept from qa_ids)`,'42501');
   await db.exec(`update public.qb_departments set name='Renamed',color='#123456' where id=(select dept from qa_ids)`);
   assert.equal(await scalar(db,`select name from public.qb_departments where id=(select dept from qa_ids)`),'Renamed');
   await db.exec('reset role');
   await deny(db,`update public.qb_departments set org_id=(select other_org from qa_ids) where id=(select dept from qa_ids)`,'23503');
   await deny(db,`insert into public.qb_projects(org_id,department_id,title,created_by) select other_org,dept,'Mismatch',admin from qa_ids`,'23503');
  });
 } finally {await db.close();}
});

test('Additive upgrade preserves populated baseline and unrelated MeetingDesk data',async()=>{
 const db=await database({migrate:false});
 try{
  await db.exec(fixture+'commit;');
  await db.exec(`create table public.meeting_workspaces(user_id uuid primary key,payload jsonb,revision bigint,updated_at timestamptz);
   alter table public.meeting_workspaces enable row level security;
   create policy own_workspace on public.meeting_workspaces for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
   insert into public.meeting_workspaces select admin,'{"version":1,"meetings":[],"templates":[]}',7,now() from qa_ids;`);
  const tables=['qb_organizations','qb_org_members','qb_departments','qb_department_members','qb_projects','qb_project_members','qb_tasks','qb_checklist','meeting_workspaces'];
  async function snapshot(){const out={};for(const table of tables) out[table]=(await db.query(`select * from public.${table} order by 1,2`)).rows;return out;}
  const before=await snapshot();
  const policies=(await db.query("select * from pg_policies where tablename='meeting_workspaces'")).rows;
  await applyMigrations(db);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await db.query("select * from pg_policies where tablename='meeting_workspaces'")).rows,policies);
  assert.equal(await scalar(db,"select relrowsecurity from pg_class where oid='public.meeting_workspaces'::regclass"),true);
 }finally{await db.close();}
});

test('Inconsistent existing hierarchy aborts the entire migration without partial grant changes',async()=>{
 const db=await database({migrate:false});
 try{
  await db.exec(fixture+`update public.qb_projects set org_id=(select other_org from qa_ids);commit;`);
  await assert.rejects(()=>applyMigrations(db),e=>e.code==='23503');
  await db.exec('rollback');
  assert.equal(await scalar(db,"select has_table_privilege('authenticated','public.qb_departments','UPDATE')"),true);
  assert.equal(await scalar(db,"select count(*)::int from pg_constraint where conname='qb_departments_id_org_unique'"),0);
 }finally{await db.close();}
});
