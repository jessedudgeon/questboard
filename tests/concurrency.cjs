// Explicit opt-in, disposable localhost database only; never accepts a connection URL.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');
if(process.env.QB_RUN_DATABASE_TESTS!=='1') throw Error('Requires disposable CI PostgreSQL and QB_RUN_DATABASE_TESTS=1');
const config={host:'127.0.0.1',port:Number(process.env.QB_TEST_PG_PORT||5432),database:'questboard_test',user:'postgres',password:'questboard-test-only'};
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
async function connect(){const c=new Client(config);await c.connect();await c.query("set statement_timeout='10s'");return c;}
async function signed(c,id){await c.query('begin; set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);}
function pending(c,sql,args){return c.query(sql,args).then(result=>({result}),error=>({error}));}
async function blocked(observer,pid){
 const end=Date.now()+5000;
 while(Date.now()<end){
  const {rows}=await observer.query("select wait_event_type from pg_stat_activity where pid=$1",[pid]);
  if(rows[0]?.wait_event_type==='Lock')return;
  await new Promise(r=>setTimeout(r,25));
 }
 assert.fail('Expected second transaction to wait on a PostgreSQL lock');
}
test('Real PostgreSQL transaction races preserve workflow and suspension',async t=>{
 const admin=await connect(),a=await connect(),b=await connect();
 try{
  const {rows}=await admin.query("select count(*)::int n from information_schema.tables where table_schema in ('public','auth')");
  assert.equal(rows[0].n,0,'Refuse to initialize a nonempty database');
  await admin.query(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const f of fs.readdirSync(path.join(__dirname,'../schema')).sort())if(f.endsWith('.sql'))await admin.query(source('schema/'+f));
  for(const f of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).sort())if(f.endsWith('.sql'))await admin.query(source('supabase/migrations/'+f));
  // Run existing regression on native PostgreSQL as well as PGlite.
  await admin.query(source('tests/permissions.sql'));
  const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  async function scenario(name,fn){await t.test(name,async()=>{
   await admin.query('drop table if exists pg_temp.qa_ids');
   await admin.query(source('tests/permissions.sql').split('create function pg_temp.must_deny')[0]+'commit;');
   const ids=(await admin.query('select * from qa_ids')).rows[0];
   try {await fn(ids);}finally{await a.query('rollback');await b.query('rollback');}
  });}
  async function ready(ids){await admin.query("update public.qb_tasks set status='in_progress' where id=$1",[ids.task]);await admin.query('update public.qb_checklist set done=true where id=$1',[ids.item]);}
  async function invitation(ids){return (await admin.query(`insert into public.qb_invitations(org_id,scope_type,invite_role,invited_email,created_by)
   values($1,'organization','member',$2,$3) returning id`,[ids.org,'questboard-viewer-'+ids.viewer+'@example.invalid',ids.admin])).rows[0].id;}
  async function finishWait(wait,code){await blocked(admin,pid);await a.query('commit');const r=await wait;if(code)assert.equal(r.error?.code,code,r.error?.message);else assert.equal(r.error,undefined);await b.query(code?'rollback':'commit');}

  await scenario('Concurrent project settings edits reject the stale second editor',async ids=>{
   await signed(a,ids.admin);await signed(b,ids.reserve);
   const sql="select qb_save_project_settings($1,1,$2,'Outcome','paused',null)";
   await a.query(sql,[ids.project,'First edit']);
   await finishWait(pending(b,sql,[ids.project,'Stale edit']),'40001');
   const row=(await admin.query('select title,revision from qb_projects where id=$1',[ids.project])).rows[0];
   assert.equal(row.title,'First edit');assert.equal(row.revision,2);
   assert.equal((await admin.query('select count(*)::int n from qb_project_changes where project_id=$1',[ids.project])).rows[0].n,1);
  });
  await scenario('Concurrent notification reads preserve the first read timestamp',async ids=>{
   const id=(await admin.query("insert into qb_notifications(org_id,task_id,recipient_id,kind) values($1,$2,$3,'assigned') returning id",[ids.org,ids.task,ids.viewer])).rows[0].id;
   await signed(a,ids.viewer);await signed(b,ids.viewer);
   assert.equal((await a.query('select qb_read_notifications(array[$1::uuid],true) n',[id])).rows[0].n,1);
   const first=(await a.query('select read_at from qb_notifications where id=$1',[id])).rows[0].read_at;
   const wait=pending(b,'select qb_read_notifications(array[$1::uuid],true) n',[id]);
   await finishWait(wait);
   assert.equal((await admin.query('select read_at from qb_notifications where id=$1',[id])).rows[0].read_at.toISOString(),first.toISOString());
  });
  await scenario('Concurrent template creation retries create one task and checklist',async ids=>{
   const request=(await admin.query('select gen_random_uuid() id')).rows[0].id;
   await signed(a,ids.admin);
   const template=(await a.query("select qb_save_task_template($1,'Repeat work',7,gen_random_uuid()) id",[ids.task])).rows[0].id;
   await a.query('commit');
   await signed(a,ids.admin);await signed(b,ids.admin);
   const sql="select qb_create_template_task($1,$2,'Repeat','Outcome','normal',null,null,30,null) id";
   const args=[template,request];
   await a.query(sql,args);await finishWait(pending(b,sql,args));
   assert.equal((await admin.query('select count(*)::int n from qb_tasks where id=$1',[request])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int n from qb_checklist where task_id=$1',[request])).rows[0].n,1);
  });
  await scenario('Milestone retries create one task and concurrent edits reject stale revisions',async ids=>{
   await signed(a,ids.admin);
   const milestone=(await a.query("select qb_save_milestone(gen_random_uuid(),$1,'Delivery','Goal','2027-01-01',false,null) id",[ids.project])).rows[0].id;
   await a.query('commit');await signed(a,ids.admin);await signed(b,ids.admin);
   const request=(await admin.query('select gen_random_uuid() id')).rows[0].id;
   const create="select qb_create_milestone_task($1,$2,$3,null,'Delivery task','Goal','normal',null,null,30,null)";
   await a.query(create,[ids.project,request,milestone]);
   await finishWait(pending(b,create,[ids.project,request,milestone]));
   assert.equal((await admin.query('select count(*)::int n from qb_tasks where id=$1',[request])).rows[0].n,1);
   await signed(a,ids.admin);await signed(b,ids.admin);
   const sql="select qb_save_milestone($1,$2,$3,'Goal','2027-01-01',false,1)";
   await a.query(sql,[milestone,ids.project,'First edit']);
   await finishWait(pending(b,sql,[milestone,ids.project,'Stale edit']),'40001');
   assert.equal((await admin.query('select title from qb_milestones where id=$1',[milestone])).rows[0].title,'First edit');
  });
  await scenario('Concurrent organization signup retries create exactly one organization',async ids=>{
   await signed(a,ids.admin);await signed(b,ids.admin);
   const request='cc000000-0000-0000-0000-000000000001';
   const first=(await a.query('select public.qb_create_organization($1,$2) id',['Concurrent signup',request])).rows[0].id;
   const wait=pending(b,'select public.qb_create_organization($1,$2) id',['Concurrent signup',request]);
   await blocked(admin,pid);await a.query('commit');const second=await wait;assert.equal(second.error,undefined);await b.query('commit');
   assert.equal(second.result.rows[0].id,first);
   assert.equal((await admin.query('select count(*)::int n from qb_private.organization_creation_requests where user_id=$1 and request_id=$2',[ids.admin,request])).rows[0].n,1);
  });

  await scenario('Checklist edit commits first: submission waits, then rejects incomplete work',async ids=>{
   await ready(ids);await signed(a,ids.admin);await signed(b,ids.admin);
   await a.query('select public.qb_toggle_checklist($1,false)',[ids.item]);
   await finishWait(pending(b,"select public.qb_transition_task($1,'in_review')",[ids.task]),'P0001');
   assert.equal((await admin.query('select status from public.qb_tasks where id=$1',[ids.task])).rows[0].status,'in_progress');
  });
  await scenario('Review commits first: toggle waits, then rejects the frozen checklist',async ids=>{
   await ready(ids);await signed(a,ids.admin);await signed(b,ids.admin);
   await a.query("select public.qb_transition_task($1,'in_review')",[ids.task]);
   await finishWait(pending(b,'select public.qb_toggle_checklist($1,false)',[ids.item]),'55000');
   assert.equal((await admin.query('select done from public.qb_checklist where id=$1',[ids.item])).rows[0].done,true);
  });
  await scenario('Review commits first: new objective waits, then is rejected',async ids=>{
   await ready(ids);await signed(a,ids.admin);await signed(b,ids.admin);
   await a.query("select public.qb_transition_task($1,'in_review')",[ids.task]);
   await finishWait(pending(b,"insert into public.qb_checklist(task_id,title) values($1,'Concurrent objective')",[ids.task]),'55000');
  });
  await scenario('Suspension commits first: invitation waits, then cannot restore membership',async ids=>{
   const inv=await invitation(ids);await a.query('begin');await signed(b,ids.viewer);
   await a.query("update public.qb_org_members set status='suspended' where org_id=$1 and user_id=$2",[ids.org,ids.viewer]);
   await finishWait(pending(b,'select public.qb_accept_invitation($1)',[inv]),'42501');
   assert.equal((await admin.query('select status from public.qb_invitations where id=$1',[inv])).rows[0].status,'revoked');
  });
  await scenario('Acceptance commits first: suspension waits, then remains authoritative',async ids=>{
   const inv=await invitation(ids);await signed(a,ids.viewer);await b.query('begin');
   await a.query('select public.qb_accept_invitation($1)',[inv]);
   await finishWait(pending(b,"update public.qb_org_members set status='suspended' where org_id=$1 and user_id=$2",[ids.org,ids.viewer]));
   assert.equal((await admin.query('select status from public.qb_org_members where org_id=$1 and user_id=$2',[ids.org,ids.viewer])).rows[0].status,'suspended');
   await signed(b,ids.viewer);
   assert.equal((await b.query('select qb_private.can_view_project($1) allowed',[ids.project])).rows[0].allowed,false);
  });
  await scenario('Issuer demotion commits first: waiting acceptance is denied',async ids=>{
   const inv=await invitation(ids);await a.query('begin');await signed(b,ids.viewer);
   await a.query("update public.qb_org_members set role='member' where org_id=$1 and user_id=$2",[ids.org,ids.admin]);
   await finishWait(pending(b,'select public.qb_accept_invitation($1)',[inv]),'42501');
  });
  await scenario('Organization suspension commits first: assignment waits and rejects target',async ids=>{
   await a.query('begin');await signed(b,ids.admin);
   await a.query("update public.qb_org_members set status='suspended' where org_id=$1 and user_id=$2",[ids.org,ids.viewer]);
   await finishWait(pending(b,'update public.qb_tasks set assignee_id=$1 where id=$2',[ids.viewer,ids.task]),'42501');
  });
  await scenario('Assignment commits first: suspension waits and removes access',async ids=>{
   await signed(a,ids.admin);await b.query('begin');
   await a.query('update public.qb_tasks set assignee_id=$1 where id=$2',[ids.viewer,ids.task]);
   await finishWait(pending(b,"update public.qb_org_members set status='suspended' where org_id=$1 and user_id=$2",[ids.org,ids.viewer]));
   await signed(b,ids.viewer);
   assert.equal((await b.query('select qb_private.can_view_project($1) allowed',[ids.project])).rows[0].allowed,false);
  });
  await scenario('Organization suspension commits first: project membership waits and rejects target',async ids=>{
   await a.query('begin');await signed(b,ids.admin);
   await a.query("update public.qb_org_members set status='suspended' where org_id=$1 and user_id=$2",[ids.org,ids.viewer]);
   await finishWait(pending(b,"insert into public.qb_project_members(project_id,user_id,role) values($1,$2,'viewer')",[ids.project,ids.viewer]),'42501');
  });
  const membership=(type,scope,user,action,role,expectedRole,status)=>({text:'select public.qb_manage_membership($1,$2,$3,$4,$5,$6,$7)',values:[type,scope,user,action,role,expectedRole,status]});
  await scenario('Direct database writes also serialize and preserve the last active administrator',async ids=>{
   await a.query('begin');await b.query('begin');
   await a.query("update public.qb_org_members set role='member' where org_id=$1 and user_id=$2",[ids.org,ids.admin]);
   await finishWait(pending(b,"update public.qb_org_members set role='member' where org_id=$1 and user_id=$2",[ids.org,ids.reserve]),'23514');
  });
  await scenario('Two administrators demote themselves: second waits and cannot remove last admin',async ids=>{
   await signed(a,ids.admin);await signed(b,ids.reserve);
   await a.query(membership('organization',ids.org,ids.admin,'role','member','admin','active'));
   await finishWait(pending(b,membership('organization',ids.org,ids.reserve,'role','member','admin','active')),'23514');
  });
  await scenario('Two department managers demoted: second waits and preserves last manager',async ids=>{
   await signed(a,ids.admin);await signed(b,ids.reserve);
   await a.query(membership('department',ids.dept,ids.admin,'role','contributor','manager','active'));
   await finishWait(pending(b,membership('department',ids.dept,ids.reserve,'role','contributor','manager','active')),'23514');
  });
  await scenario('Stale simultaneous membership changes: second waits and requires reload',async ids=>{
   await signed(a,ids.admin);await signed(b,ids.reserve);
   await a.query(membership('department',ids.dept,ids.viewer,'suspend',null,'viewer','active'));
   await finishWait(pending(b,membership('department',ids.dept,ids.viewer,'role','contributor','viewer','active')),'40001');
  });
  await scenario('Administrator demotion commits before waiting administration: authority is rechecked',async ids=>{
   await signed(a,ids.reserve);await signed(b,ids.admin);
   await a.query(membership('organization',ids.org,ids.admin,'role','member','admin','active'));
   await finishWait(pending(b,membership('organization',ids.org,ids.viewer,'role','admin','member','active')),'42501');
  });
  await scenario('Two simultaneous acceptances: only the first succeeds',async ids=>{
   const inv=await invitation(ids);await signed(a,ids.viewer);await signed(b,ids.viewer);
   await a.query('select public.qb_accept_invitation($1)',[inv]);
   await finishWait(pending(b,'select public.qb_accept_invitation($1)',[inv]),'42501');
  });
  async function prerequisite(ids,complete=false){
   const row=(await admin.query("insert into public.qb_tasks(project_id,title,created_by) values($1,'Dependency prerequisite',$2) returning id",[ids.project,ids.admin])).rows[0];
   if(complete)await admin.query("update public.qb_tasks set status='complete' where id=$1",[row.id]);
   await admin.query("update public.qb_tasks set status='ready' where id=$1",[ids.task]);return row.id;
  }
  await scenario('Concurrent reverse links serialize and cannot create a cycle',async ids=>{
   const pre=await prerequisite(ids);await signed(a,ids.admin);await signed(b,ids.admin);
   await a.query('select public.qb_set_task_dependency($1,$2,true)',[ids.task,pre]);
   await finishWait(pending(b,'select public.qb_set_task_dependency($1,$2,true)',[pre,ids.task]),'23514');
  });
  await scenario('New unfinished prerequisite commits before a waiting start',async ids=>{
   const pre=await prerequisite(ids);await signed(a,ids.admin);await signed(b,ids.admin);
   await a.query('select public.qb_set_task_dependency($1,$2,true)',[ids.task,pre]);
   await finishWait(pending(b,"select public.qb_transition_task($1,'in_progress')",[ids.task]),'55000');
  });
  await scenario('Starting work commits before a waiting new prerequisite',async ids=>{
   const pre=await prerequisite(ids);await signed(a,ids.admin);await signed(b,ids.admin);
   await a.query("select public.qb_transition_task($1,'in_progress')",[ids.task]);
   await finishWait(pending(b,'select public.qb_set_task_dependency($1,$2,true)',[ids.task,pre]),'55000');
  });
  for(const first of ['reopen','start'])await scenario(`Prerequisite ${first} wins and conflicting dependent operation is rejected`,async ids=>{
   const pre=await prerequisite(ids,true);await signed(a,ids.admin);
   await a.query('select public.qb_set_task_dependency($1,$2,true)',[ids.task,pre]);await a.query('commit');
   await signed(a,ids.admin);await signed(b,ids.admin);
   await a.query("select public.qb_transition_task($1,'in_progress')",[first==='reopen'?pre:ids.task]);
   await finishWait(pending(b,"select public.qb_transition_task($1,'in_progress')",[first==='reopen'?ids.task:pre]),'55000');
  });
 }finally{await Promise.all([admin.end(),a.end(),b.end()]);}
});
