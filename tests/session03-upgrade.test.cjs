const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const read=f=>fs.readFileSync(__dirname+'/../'+f,'utf8');
test('Populated Session 2 upgrades once to Session 3 without rewriting shared or historical rows',async()=>{
 const db=await database({migrate:false});
 try{
  await db.exec(read('supabase/migrations/20261027120006_questboard_session02_authorization.sql'));
  await db.exec(read('tests/permissions.sql').split('create function pg_temp.must_deny')[0]+'commit;');
  await db.exec(`create table public.meetingdesk_upgrade_canary(id int primary key, note text);
   insert into public.meetingdesk_upgrade_canary values(1,'untouched');
   alter table public.meetingdesk_upgrade_canary enable row level security;
   create policy canary_read on public.meetingdesk_upgrade_canary for select using(false);
   update public.qb_tasks set assignee_id=(select viewer from qa_ids);
   update public.qb_org_members set status='suspended' where user_id=(select viewer from qa_ids);`);
  const before=await db.query('select * from public.qb_tasks order by id');
  const policy=await db.query("select * from pg_policies where tablename='meetingdesk_upgrade_canary'");
  await db.exec(read('supabase/migrations/20261027145136_questboard_session03_scoped_identity.sql'));
  assert.deepEqual((await db.query('select * from public.qb_tasks order by id')).rows,before.rows);
  assert.deepEqual((await db.query("select * from pg_policies where tablename='meetingdesk_upgrade_canary'")).rows,policy.rows);
  assert.deepEqual((await db.query('select * from public.meetingdesk_upgrade_canary')).rows,[{id:1,note:'untouched'}]);
  assert.equal((await db.query("select to_regprocedure('public.qb_assignment_candidates(uuid,uuid)') is not null installed")).rows[0].installed,true);
 }finally{await db.close();}
});
