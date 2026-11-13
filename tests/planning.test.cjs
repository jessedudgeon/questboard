const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);}
async function scalar(db,q){return Object.values((await db.query(q)).rows[0])[0];}
async function deny(db,q,code){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(q),e=>{if(code)assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
test('Planning schedules, effort, atomic creation, settings and invited-owner access',async()=>{
 const db=await database();try{
 await db.exec(fixture);await actor(db);
 await db.exec("update qb_projects set target_date='2027-01-29' where id=(select project from qa_ids)");
 const milestone=await scalar(db,`select qb_save_planned_milestone(gen_random_uuid(),project,'{"title":"Delivery","schedule_mode":"project","schedule_offset":-2,"duration_days":5,"estimated_hours":40}') from qa_ids`);
 assert.equal(await scalar(db,`select start_date::text from qb_milestones where id='${milestone}'`),'2027-01-23');
 const request=await scalar(db,'select gen_random_uuid()');
 const create=`select qb_create_planned_task('${request}',project,'{"title":"Work","milestone_id":"${milestone}","schedule_mode":"milestone","schedule_offset":-1,"duration_days":3,"estimated_hours":8,"remaining_hours":4}') from qa_ids`;
 assert.equal(await scalar(db,create),request);assert.equal(await scalar(db,create),request);
 assert.equal(await scalar(db,`select start_date::text from qb_tasks where id='${request}'`),'2027-01-24');
 assert.equal(Number(await scalar(db,`select estimated_hours from qb_tasks where id='${request}'`)),8);
 await db.exec("update qb_projects set target_date='2027-02-05' where id=(select project from qa_ids)");
 assert.equal(await scalar(db,`select due_date::text from qb_tasks where id='${request}'`),'2027-02-02');
 assert.equal(await scalar(db,'select due_date from qb_tasks where id=(select task from qa_ids)'),null);
 const rev=await scalar(db,`select revision from qb_milestones where id='${milestone}'`);
 await db.exec(`select qb_save_planned_milestone('${milestone}',project,'{"title":"Delivery","due_date":"2027-03-01","schedule_mode":"fixed","estimated_hours":32}',${rev}) from qa_ids`);
 assert.equal(await scalar(db,`select due_date::text from qb_tasks where id='${request}'`),'2027-02-28');
 await deny(db,`select qb_save_planned_milestone('${milestone}',project,'{"title":"stale","due_date":"2027-03-01"}',${rev}) from qa_ids`,'40001');
 await deny(db,"update qb_tasks set start_date='2028-01-01',due_date='2027-01-01' where id=(select task from qa_ids)",'23514');
 await deny(db,"update qb_tasks set estimated_hours=-1 where id=(select task from qa_ids)",'23514');
 const bad=await scalar(db,'select gen_random_uuid()');
 await deny(db,`select qb_create_planned_task('${bad}',project,'{"title":"Invalid","schedule_mode":"milestone"}') from qa_ids`,'22023');
 assert.equal(await scalar(db,`select count(*)::int from qb_tasks where id='${bad}'`),0);
 await db.exec(`select qb_save_planning_settings(org,'organization',org,'{"weekly_capacity_hours":24,"workdays":[1,2,3,4,5]}') from qa_ids`);
 await deny(db,`select qb_save_planning_settings(org,'organization',org,'{}',0) from qa_ids`,'40001');
 await deny(db,`select qb_save_planning_settings(org,'organization',org,'{"workdays":[1,1]}',1) from qa_ids`,'22023');
 await deny(db,`select qb_save_planning_settings(other_org,'department',dept,'{}') from qa_ids`,'42501');
 const invite=await scalar(db,`insert into qb_invitations(org_id,scope_type,scope_id,invite_role,invited_email,created_by) select org,'organization',null,'member','pending@example.invalid',admin from qa_ids returning id`);
 await db.exec(`update qb_tasks set assignee_invitation_id='${invite}' where id=(select task from qa_ids)`);
 assert.equal(await scalar(db,'select assignee_id from qb_tasks where id=(select task from qa_ids)'),null);
 assert.equal(await scalar(db,'select planned_assignee_label from qb_tasks where id=(select task from qa_ids)'),'pending@example.invalid');
 assert.equal(await scalar(db,'select count(*)::int from qb_invited_assignment_candidates((select project from qa_ids))'),1);
 await db.exec(`insert into qb_staff_capacity(org_id,owner_key,weekly_hours) select org,'invite:${invite}',20 from qa_ids`);
 await deny(db,`insert into qb_staff_capacity(org_id,owner_key,weekly_hours) select other_org,'invite:${invite}',20 from qa_ids`,'42501');
 await actor(db,'viewer');
 assert.equal(await scalar(db,'select count(*)::int from qb_invited_assignment_candidates((select project from qa_ids))'),0);
 assert.equal(await scalar(db,'select weekly_hours::int from qb_staff_capacity'),20);
 await deny(db,`select qb_save_planning_settings(org,'organization',org,'{}',1) from qa_ids`,'42501');
 await deny(db,`select qb_save_task_plan(task,'{"estimated_hours":5}') from qa_ids`,'42501');
 await db.exec('reset role;delete from qb_department_members where user_id=(select viewer from qa_ids)');
 await db.exec("reset role;update qb_invitations set status='accepted',accepted_by=(select viewer from qa_ids) where id='"+invite+"'");
 assert.equal(await scalar(db,'select assignee_id from qb_tasks where id=(select task from qa_ids)'),null);
 await db.exec("insert into qb_project_members(project_id,user_id,role) select project,viewer,'contributor' from qa_ids");
 assert.equal(await scalar(db,'select assignee_id=(select viewer from qa_ids) from qb_tasks where id=(select task from qa_ids)'),true);
 assert.equal(await scalar(db,"select weekly_hours::int from qb_staff_capacity where owner_key='user:'||(select viewer::text from qa_ids)"),20);
 assert.equal(await scalar(db,'select assignee_invitation_id from qb_tasks where id=(select task from qa_ids)'),null);

 await actor(db);
 const vendor=await scalar(db,"insert into qb_vendors(org_id,name) select org,'Carrier vendor' from qa_ids returning id");
 const contact=await scalar(db,`insert into qb_vendor_contacts(org_id,vendor_id,name,email) select org,'${vendor}','Porting contact','contact@example.invalid' from qa_ids returning id`);
 await db.exec(`update qb_tasks set vendor_dependent=true,vendor_id='${vendor}',vendor_contact_id='${contact}',vendor_followup_date='2027-01-08' where id=(select task from qa_ids)`);
 assert.equal(await scalar(db,'select vendor_dependent from qb_tasks where id=(select task from qa_ids)'),true);
 await deny(db,`update qb_tasks set vendor_dependent=false where id=(select task from qa_ids)`,'22023');
 await db.exec('reset role');
 const foreign=await scalar(db,"insert into qb_vendors(org_id,name) select other_org,'Foreign vendor' from qa_ids returning id");
 await actor(db);await deny(db,`update qb_tasks set vendor_id='${foreign}',vendor_contact_id=null where id=(select task from qa_ids)`,'42501');
 const otherVendor=await scalar(db,"insert into qb_vendors(org_id,name) select org,'Different vendor' from qa_ids returning id");
 await deny(db,`update qb_tasks set vendor_id='${otherVendor}' where id=(select task from qa_ids)`,'23503');
 await actor(db,'viewer');assert.equal(await scalar(db,'select count(*)::int from qb_vendors'),2);
 await deny(db,"insert into qb_vendors(org_id,name) select org,'Not permitted' from qa_ids",'42501');
 await actor(db);
 // A blank fixed deadline stays blank; the explicit linked option follows its milestone.
 await db.exec(`update qb_tasks set milestone_id='${milestone}',schedule_mode='milestone_deadline' where id=(select task from qa_ids)`);
 assert.equal(await scalar(db,'select due_date::text from qb_tasks where id=(select task from qa_ids)'),'2027-03-01');
 await db.exec('set constraints all immediate;set constraints all deferred');
 await deny(db,`update qb_tasks set schedule_mode='fixed',due_date='2027-03-02' where id=(select task from qa_ids);set constraints all immediate`,'22023');
 await deny(db,`update qb_milestones set start_date='2027-03-01' where id='${milestone}';set constraints all immediate`,'22023');
 await db.exec(`update qb_milestones set due_date='2027-03-08' where id='${milestone}'`);
 assert.equal(await scalar(db,'select due_date::text from qb_tasks where id=(select task from qa_ids)'),'2027-03-08');
 await db.exec('set constraints all immediate;set constraints all deferred');
 }finally{await db.exec('rollback');await db.close();}
});
