const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
test('Scoped managers can self-approve with audit and one XP award; ordinary and suspended reviewers cannot',async t=>{
 const db=await database();
 try{for(const kind of ['lead','manager','reviewer','suspended'])await t.test(kind,async()=>{
 await db.exec(fixture);
 try{
 await db.exec(`update public.qb_tasks set assignee_id=(select viewer from qa_ids),reviewer_id=(select viewer from qa_ids) where id=(select task from qa_ids);
 update public.qb_checklist set done=true where id=(select item from qa_ids);
 update public.qb_tasks set status='in_review' where id=(select task from qa_ids);`);
 if(kind==='lead')await db.exec("insert into public.qb_project_members(project_id,user_id,role) select project,viewer,'lead' from qa_ids");
 if(['manager','suspended'].includes(kind))await db.exec("update public.qb_department_members set role='manager' where user_id=(select viewer from qa_ids)");
 if(kind==='suspended')await db.exec("update public.qb_org_members set status='suspended' where user_id=(select viewer from qa_ids)");
 await db.exec("set local role authenticated;select set_config('request.jwt.claim.sub',(select viewer::text from qa_ids),true)");
 const complete="select public.qb_transition_task(task,'complete') from qa_ids";
 if(['reviewer','suspended'].includes(kind)){await assert.rejects(db.exec(complete),e=>e.code==='P0001');return;}
 await db.exec(complete);
 const rows=(await db.query("select e.actor_id=t.assignee_id as self_approved,e.after_data->>'status' as status from public.qb_task_events e join public.qb_tasks t on t.id=e.task_id where e.event_type='status'")).rows;
 assert(rows.some(r=>r.self_approved&&r.status==='complete'));
 await db.exec("select public.qb_transition_task(task,'in_progress') from qa_ids;select public.qb_transition_task(task,'in_review') from qa_ids;"+complete);
 assert.equal((await db.query('select count(*)::int as n from public.qb_xp_events')).rows[0].n,1);
 }finally{await db.exec('rollback;reset role');}
 });}finally{await db.close();}
});
