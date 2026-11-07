const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);}
async function scalar(db,q){return Object.values((await db.query(q)).rows[0])[0];}
async function deny(db,q,code){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(q),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
test('Notifications follow workflow, suppress self events and honor current task access',async()=>{
 const db=await database();try{
  await db.exec(fixture);await actor(db);
  await db.exec('update qb_tasks set assignee_id=(select viewer from qa_ids),reviewer_id=(select admin from qa_ids) where id=(select task from qa_ids)');
  assert.equal(await scalar(db,'select count(*) from qb_notifications'),0);
  await actor(db,'viewer');assert.equal(await scalar(db,"select count(*) from qb_notifications where kind='assigned'"),1);
  const notice=await scalar(db,'select id from qb_notifications limit 1');
  assert.equal(await scalar(db,`select qb_read_notifications(array['${notice}'::uuid],true)`),1);
  assert.equal(await scalar(db,`select qb_read_notifications(array['${notice}'::uuid],true)`),0);
  assert.equal(await scalar(db,'select unread_count from qb_notification_summary((select org from qa_ids))'),0);
  await scalar(db,`select qb_read_notifications(array['${notice}'::uuid],false)`);
  await deny(db,`update qb_notifications set recipient_id=(select admin from qa_ids)`,'42501');
  await deny(db,"insert into qb_notifications(org_id,task_id,recipient_id,kind) select org,task,viewer,'assigned' from qa_ids",'42501');
  await actor(db);assert.equal(await scalar(db,`select qb_read_notifications(array['${notice}'::uuid],true)`),0);
  await db.exec("select qb_transition_task(task,'ready') from qa_ids");await actor(db,'viewer');
  await db.exec("select qb_transition_task(task,'in_progress') from qa_ids;select qb_toggle_checklist(item,true) from qa_ids;select qb_transition_task(task,'in_review') from qa_ids");
  await actor(db);assert.equal(await scalar(db,"select count(*) from qb_notifications where kind='review_requested'"),1);
  await db.exec("select qb_transition_task(task,'in_progress') from qa_ids");
  await actor(db,'viewer');assert.equal(await scalar(db,"select count(*) from qb_notifications where kind='changes_requested'"),1);
  await db.exec("select qb_transition_task(task,'in_review') from qa_ids");await actor(db);await db.exec("select qb_transition_task(task,'complete') from qa_ids");
  await db.exec("update qb_tasks set due_date='2027-01-01' where id=(select task from qa_ids);update qb_tasks set due_date='2027-01-01' where id=(select task from qa_ids)");
  await actor(db,'viewer');assert.equal(await scalar(db,"select count(*) from qb_notifications where kind='completed'"),1);assert.equal(await scalar(db,"select count(*) from qb_notifications where kind='schedule_changed'"),1);
  await db.exec("insert into qb_task_updates(task_id,author_id,kind,body) select task,viewer,'note','Work update' from qa_ids");
  assert.equal(await scalar(db,"select count(*) from qb_notifications where kind='task_update'"),0);
  await actor(db);assert.equal(await scalar(db,"select count(*) from qb_notifications where kind='task_update'"),1);
  await db.exec("reset role;update qb_tasks set visibility='restricted',assignee_id=null,reviewer_id=null where id=(select task from qa_ids)");
  await actor(db,'viewer');assert.equal(await scalar(db,'select count(*) from qb_notifications'),0);
  assert.equal(await scalar(db,'select unread_count from qb_notification_summary((select org from qa_ids))'),0);
  await db.exec("reset role;update qb_tasks set visibility='inherit' where id=(select task from qa_ids);update qb_org_members set status='suspended' where org_id=(select org from qa_ids) and user_id=(select viewer from qa_ids)");
  await actor(db,'viewer');assert.equal(await scalar(db,'select count(*) from qb_notifications'),0);
  await db.exec('reset role;set local role anon');await deny(db,'select * from qb_notifications','42501');await deny(db,'select * from qb_notification_page(null)','42501');
 }finally{await db.exec('rollback');await db.close();}
});
test('Notification paging has stable cursors and applies organization, department, query and unread filters',async()=>{
 const db=await database();try{
  await db.exec(fixture+"insert into qb_notifications(org_id,task_id,recipient_id,kind) select org,task,viewer,'assigned' from qa_ids,generate_series(1,65);");
  await actor(db,'viewer');
  const first=(await db.query('select * from qb_notification_page((select org from qa_ids))')).rows;
  assert.equal(first.length,51);const cursor=first[49];
  const second=(await db.query(`select * from qb_notification_page((select org from qa_ids),false,null,'','${new Date(cursor.created_at).toISOString()}','${cursor.id}')`)).rows;
  assert.equal(second.length,15);assert.equal(new Set([...first.slice(0,50),...second].map(r=>r.id)).size,65);
  assert.equal(await scalar(db,"select count(*) from qb_notification_page((select other_org from qa_ids))"),0);
  assert.equal(await scalar(db,"select count(*) from qb_notification_page((select org from qa_ids),false,(select other_dept from qa_ids))"),0);
  assert.equal(await scalar(db,"select count(*) from qb_notification_page((select org from qa_ids),false,null,'no match')"),0);
  await db.exec(`select qb_read_notifications(array['${first[0].id}'::uuid],true)`);
  assert.equal(await scalar(db,'select unread_count from qb_notification_summary((select org from qa_ids))'),64);
  const unread=(await db.query('select * from qb_notification_page((select org from qa_ids),true)')).rows;
  assert(!unread.some(n=>n.id===first[0].id));
 }finally{await db.exec('rollback');await db.close();}
});
