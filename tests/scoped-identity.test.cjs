const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {database,applyMigrations}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
const extra=`
 create temporary table scoped_ids as select gen_random_uuid() manager,gen_random_uuid() worker,gen_random_uuid() reviewer,
 gen_random_uuid() lead,gen_random_uuid() orgadmin,gen_random_uuid() unrelated,gen_random_uuid() outsider,
 gen_random_uuid() suspended,gen_random_uuid() separate_dept,gen_random_uuid() restricted,gen_random_uuid() restricted_task;
 grant select on scoped_ids to authenticated;
 insert into auth.users(id,email,email_confirmed_at)
 select value::text::uuid,key||'-'||value::text||'@example.invalid',now() from scoped_ids s,jsonb_each_text(to_jsonb(s))
 where key in ('manager','worker','reviewer','lead','orgadmin','unrelated','outsider','suspended');
 insert into public.qb_org_members(org_id,user_id,role)
 select case when key='outsider' then q.other_org else q.org end,value::uuid,case when key='orgadmin' then 'admin' else 'member' end
 from scoped_ids s,qa_ids q,jsonb_each_text(to_jsonb(s)) where key in ('manager','worker','reviewer','lead','orgadmin','unrelated','outsider','suspended');
 insert into public.qb_department_members(department_id,user_id,role)
 select q.dept,value::uuid,case when key='manager' then 'manager' else 'contributor' end
 from scoped_ids s,qa_ids q,jsonb_each_text(to_jsonb(s)) where key in ('manager','worker','suspended');
 insert into public.qb_project_members(project_id,user_id,role)
 select q.project,value::uuid,case when key='lead' then 'lead' else 'viewer' end
 from scoped_ids s,qa_ids q,jsonb_each_text(to_jsonb(s)) where key in ('lead','reviewer');
 insert into public.qb_departments(id,org_id,name) select s.separate_dept,q.org,'Separate' from scoped_ids s,qa_ids q;
 insert into public.qb_department_members(department_id,user_id,role) select separate_dept,unrelated,'contributor' from scoped_ids;
 insert into public.qb_projects(id,org_id,department_id,title,visibility,created_by)
 select s.restricted,q.org,q.dept,'Restricted','restricted',q.admin from scoped_ids s,qa_ids q;
 insert into public.qb_tasks(id,project_id,title,visibility,created_by)
 select s.restricted_task,s.restricted,'Restricted task','restricted',q.admin from scoped_ids s,qa_ids q;
 insert into public.qb_task_participants(task_id,user_id) select s.restricted_task,q.admin from scoped_ids s,qa_ids q;
 insert into public.qb_profiles(user_id,display_name) select id,split_part(email,'-',1) from auth.users;
 update public.qb_org_members set status='suspended' where user_id=(select suspended from scoped_ids);
`;
async function actor(db,name){await db.exec('reset role;set local role authenticated');await db.exec(`select set_config('request.jwt.claim.sub',(select ${name}::text from ${['admin','viewer'].includes(name)?'qa_ids':'scoped_ids'}),true)`);}
async function deny(db,sql,code='42501'){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(sql),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
async function one(db,sql){return Object.values((await db.query(sql)).rows[0])[0];}
const target=name=>`(select ${name} from scoped_ids)`;
const assign=(name,key='assignee_id')=>`update public.qb_tasks set ${key}=${target(name)} where id=(select task from qa_ids)`;

test('Session 3 scoped identity and assignment matrix',async t=>{
 const db=await database();
 async function check(name,run){await t.test(name,async()=>{await db.exec(fixture+extra);try{await run(db);}finally{await db.exec('reset role;rollback');}});}
 try{
  for(const role of ['viewer','worker','manager','lead','reviewer']){
   await check(`F04 ${role}: collaborator names visible; unrelated/suspended/other-org names hidden`,async db=>{
    await actor(db,role);
    assert.equal(await one(db,`select count(*)::int from public.qb_profiles where user_id in ((select admin from qa_ids),${target('worker')},${target('reviewer')},${target('lead')})`),4);
    assert.equal(await one(db,`select count(*)::int from public.qb_profiles where user_id in (${target('unrelated')},${target('outsider')},${target('suspended')},${target('orgadmin')})`),0);
    assert.equal(await one(db,'select count(*)::int from public.qb_org_members'),1,'profile fix must not widen roster access');
   });
  }
  await check('F04 org admin sees active org profiles but gains no project-content access',async db=>{
   await actor(db,'orgadmin');
   assert.equal(await one(db,`select count(*)::int from public.qb_profiles where user_id=${target('unrelated')}`),1);
   assert.equal(await one(db,`select count(*)::int from public.qb_profiles where user_id in (${target('outsider')},${target('suspended')})`),0);
   assert.equal(await one(db,'select count(*)::int from public.qb_projects'),0);
   await deny(db,'select * from public.qb_assignment_candidates((select project from qa_ids))');
  });
  await check('Suspended organization user sees own profile only and no participant metadata',async db=>{
   await db.exec(`insert into public.qb_task_participants(task_id,user_id) select task,viewer from qa_ids;
    update public.qb_org_members set status='suspended' where user_id=(select viewer from qa_ids)`);
   await actor(db,'viewer');
   assert.equal(await one(db,'select count(*)::int from public.qb_profiles'),1);
   assert.equal(await one(db,'select count(*)::int from public.qb_task_participants'),0);
  });
  await check('Managers can assign active department or project-only users as worker/reviewer',async db=>{
   await actor(db,'manager');
   for(const name of ['worker','reviewer','lead'])for(const key of ['assignee_id','reviewer_id'])await db.exec(assign(name,key));
   await db.exec(`insert into public.qb_tasks(project_id,title,assignee_id,reviewer_id,created_by)
    select q.project,'Assigned',s.worker,s.reviewer,s.manager from qa_ids q,scoped_ids s`);
   assert.equal(await one(db,"select count(*)::int from public.qb_tasks where title='Assigned'"),1);
  });
  for(const name of ['unrelated','outsider','suspended','orgadmin']){
   await check(`Assignee/reviewer ${name} rejected on insert and update`,async db=>{
    await actor(db,'admin');
    for(const key of ['assignee_id','reviewer_id']){
     await deny(db,assign(name,key));
     await deny(db,`insert into public.qb_tasks(project_id,title,${key},created_by) select project,'Invalid',${target(name)},admin from qa_ids`);
    }
   });
  }
  await check('Project-only lead may assign; ordinary worker/viewer/reviewer cannot edit task metadata',async db=>{
   await actor(db,'lead');await db.exec(assign('worker'));
   for(const role of ['worker','viewer','reviewer']){
    await actor(db,role);
    // RLS denial on UPDATE can be a zero-row result, not an exception.
    const result=await db.query(`update public.qb_tasks set assignee_id=${target('reviewer')} where id=(select task from qa_ids) returning id`);
    assert.equal(result.rows.length,0);
   }
  });
  await check('Candidate RPC requires content visibility AND management; returns only active eligible names/IDs',async db=>{
   for(const role of ['admin','manager','lead']){
    await actor(db,role);
    const result=await db.query('select * from public.qb_assignment_candidates((select project from qa_ids))');
    assert(result.rows.length>=6);
    for(const row of result.rows)assert.deepEqual(Object.keys(row).sort(),['display_name','user_id']);
    const disallowed=(await db.query(`select unrelated,outsider,suspended,orgadmin from scoped_ids`)).rows[0];
    assert(!result.rows.some(r=>Object.values(disallowed).includes(r.user_id)));
   }
   for(const role of ['worker','viewer','reviewer','orgadmin','outsider','suspended']){
    await actor(db,role);await deny(db,'select * from public.qb_assignment_candidates((select project from qa_ids))');
   }
  });
  await check('Restricted project: department manager cannot bootstrap membership, tasks or candidate access',async db=>{
   await actor(db,'manager');
   await deny(db,`insert into public.qb_project_members(project_id,user_id,role) select restricted,manager,'contributor' from scoped_ids`);
   await deny(db,`insert into public.qb_tasks(project_id,title,created_by) select restricted,'Hidden',manager from scoped_ids`);
   await deny(db,'select * from public.qb_assignment_candidates((select restricted from scoped_ids))');
   assert.equal(await one(db,`select count(*)::int from public.qb_projects where id=${target('restricted')}`),0);
  });
  await check('Restricted task: project access is necessary for participation and participation for assignments',async db=>{
   await actor(db,'admin');
   await deny(db,`insert into public.qb_task_participants(task_id,user_id) select restricted_task,worker from scoped_ids`);
   // Granting a member access is allowed for an active same-org person without prior project access.
   await db.exec(`insert into public.qb_project_members(project_id,user_id,role) select restricted,worker,'contributor' from scoped_ids`);
   for(const key of ['assignee_id','reviewer_id'])await deny(db,`update public.qb_tasks set ${key}=${target('worker')} where id=${target('restricted_task')}`);
   await db.exec(`insert into public.qb_task_participants(task_id,user_id) select restricted_task,worker from scoped_ids`);
   await db.exec(`update public.qb_tasks set assignee_id=${target('worker')} where id=${target('restricted_task')}`);
   const candidates=(await db.query('select * from public.qb_assignment_candidates((select restricted from scoped_ids),(select restricted_task from scoped_ids))')).rows;
   assert.equal(candidates.length,2);
   await deny(db,'select * from public.qb_assignment_candidates((select project from qa_ids),(select restricted_task from scoped_ids))');
   await actor(db,'worker');assert.equal(await one(db,`select count(*)::int from public.qb_tasks where id=${target('restricted_task')}`),1);
  });
  await check('Scope membership and participant identities immutable; role/status still writable',async db=>{
   await actor(db,'admin');
   await db.exec(`insert into public.qb_project_members(project_id,user_id,role) select q.project,s.unrelated,'contributor' from qa_ids q,scoped_ids s`);
   await db.exec(`update public.qb_project_members set role='viewer',status='suspended' where user_id=${target('unrelated')}`);
   await deny(db,`update public.qb_project_members set user_id=${target('outsider')} where user_id=${target('unrelated')}`);
   await deny(db,`update public.qb_department_members set department_id=(select other_dept from qa_ids) where user_id=(select viewer from qa_ids)`);
   await deny(db,`update public.qb_task_participants set user_id=${target('worker')}`);
  });
  for(const table of ['qb_department_members','qb_project_members']){
   await check(`${table}: cross-org/suspended targets denied while same-org access grants work`,async db=>{
    await actor(db,'admin');const column=table==='qb_department_members'?'department_id':'project_id';const scope=table==='qb_department_members'?'dept':'project';
    for(const name of ['outsider','suspended'])await deny(db,`insert into public.${table}(${column},user_id,role) select ${scope},${target(name)},'contributor' from qa_ids`);
    await db.exec(`insert into public.${table}(${column},user_id,role) select ${scope},${target('unrelated')},'contributor' from qa_ids`);
    await deny(db,`update public.${table} set role='${table==='qb_department_members'?'manager':'lead'}' where user_id=${target('unrelated')}`);
   });
  }
  await check('Suspending the last access path removes eligibility; another active path remains valid',async db=>{
   await db.exec(`update public.qb_project_members set status='suspended' where user_id=${target('reviewer')}`);
   await actor(db,'admin');await deny(db,assign('reviewer'));
   await db.exec(`insert into public.qb_project_members(project_id,user_id,role) select q.project,s.worker,'viewer' from qa_ids q,scoped_ids s;
    update public.qb_department_members set status='suspended' where user_id=${target('worker')}`);
   await db.exec(assign('worker'));
  });
  await check('Historical assignments survive loss of access without restoring permission; unrelated edits and clearing work',async db=>{
   await actor(db,'admin');await db.exec(assign('worker'));
   await db.exec(`reset role;update public.qb_org_members set status='suspended' where user_id=${target('worker')}`);
   await actor(db,'admin');await db.exec("update public.qb_tasks set title='Preserved' where id=(select task from qa_ids)");
   assert.equal(await one(db,'select assignee_id from public.qb_tasks where id=(select task from qa_ids)'),await one(db,'select worker from scoped_ids'));
   await db.exec('update public.qb_tasks set assignee_id=null where id=(select task from qa_ids)');await deny(db,assign('worker'));
   await actor(db,'worker');assert.equal(await one(db,'select count(*)::int from public.qb_tasks'),0);
  });
  await check('Anonymous cannot read profiles/candidates; internal arbitrary-user helpers not executable',async db=>{
   await db.exec('set local role anon');await deny(db,'select * from public.qb_profiles');await deny(db,'select * from public.qb_assignment_candidates(null)');
   await actor(db,'viewer');await deny(db,'select qb_private.user_can_access_project(null,null)');await deny(db,'select qb_private.lock_project_user(null,null)');
  });
 }finally{await db.close();}
});
