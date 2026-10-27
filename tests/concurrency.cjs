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
  await scenario('Two simultaneous acceptances: only the first succeeds',async ids=>{
   const inv=await invitation(ids);await signed(a,ids.viewer);await signed(b,ids.viewer);
   await a.query('select public.qb_accept_invitation($1)',[inv]);
   await finishWait(pending(b,'select public.qb_accept_invitation($1)',[inv]),'42501');
  });
 }finally{await Promise.all([admin.end(),a.end(),b.end()]);}
});
