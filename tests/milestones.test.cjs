const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);}
async function scalar(db,q){return Object.values((await db.query(q)).rows[0])[0];}
async function deny(db,q,code){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(q),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
test('Milestone access, revision conflicts, atomic task creation and archive rules',async()=>{
 const db=await database();try{
  await db.exec(fixture);await actor(db);
  const id=await scalar(db,'select gen_random_uuid()');
  const save=(revision='null',archived=false)=>`select qb_save_milestone('${id}',project,'Delivery','Goal','2027-01-01',${archived},${revision}) from qa_ids`;
  assert.equal(await scalar(db,save()),id);assert.equal(await scalar(db,save()),id);
  await actor(db,'viewer');assert.equal(await scalar(db,'select count(*) from qb_milestones'),1);await deny(db,save(1),'42501');
  await actor(db);await scalar(db,save(1));await deny(db,save(1),'40001');
  const template=await scalar(db,"select qb_save_task_template(task,'Source',null,gen_random_uuid()) from qa_ids");
  const request=await scalar(db,'select gen_random_uuid()');
  const create=(milestone=id,req=request,pre='null',tpl=template)=>`select qb_create_milestone_task(project,'${req}','${milestone}','${tpl}','Deliver','Goal','high',null,null,30,${pre}) from qa_ids`;
  await deny(db,create(id,request,'gen_random_uuid()'),'42501');assert.equal(await scalar(db,`select count(*) from qb_tasks where id='${request}'`),0);
  assert.equal(await scalar(db,create()),request);assert.equal(await scalar(db,create()),request);
  assert.equal(await scalar(db,`select count(*) from qb_checklist where task_id='${request}'`),1);
  assert.equal(await scalar(db,`select milestone_id from qb_tasks where id='${request}'`),id);
  await scalar(db,save(2,true));
  await deny(db,`update qb_tasks set milestone_id='${id}' where id=(select task from qa_ids)`,'42501');
  await db.exec(`update qb_tasks set title='Existing linked task' where id='${request}'`);
  assert.equal(await scalar(db,create()),request);
  const newRequest=await scalar(db,'select gen_random_uuid()');await deny(db,create(id,newRequest),'42501');
  assert.equal(await scalar(db,`select count(*) from qb_tasks where id='${newRequest}'`),0);
  await scalar(db,save(3,false));
  await db.exec(`update qb_tasks set milestone_id='${id}' where id=(select task from qa_ids)`);
  await db.exec('update qb_tasks set milestone_id=null where id=(select task from qa_ids)');
  await db.exec("reset role;insert into qb_projects(org_id,department_id,title,created_by) select other_org,other_dept,'Foreign project',admin from qa_ids");
  await actor(db);
  const foreign=await scalar(db,`select qb_save_milestone(gen_random_uuid(),(select id from qb_projects where title='Foreign project'),'Foreign','Goal',current_date,false,null)`);
  await deny(db,`update qb_tasks set milestone_id='${foreign}' where id=(select task from qa_ids)`,'42501');
  await deny(db,create(foreign,newRequest),'42501');
  await actor(db,'viewer');assert.equal(await scalar(db,`select count(*) from qb_milestones where id='${foreign}'`),0);
  await actor(db);
  await db.exec("reset role;update qb_org_members set status='suspended' where user_id=(select admin from qa_ids) and org_id=(select org from qa_ids)");await actor(db);assert.equal(await scalar(db,`select count(*) from qb_milestones where id='${id}'`),0);await deny(db,create(),'42501');
  await db.exec('reset role;set local role anon');await deny(db,'select * from qb_milestones','42501');
 }finally{await db.exec('rollback');await db.close();}
});
