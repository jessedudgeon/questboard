const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);}
async function scalar(db,q){return Object.values((await db.query(q)).rows[0])[0];}
async function deny(db,q,code){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(q),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
test('Templates preserve snapshots, permissions, atomicity and retry identity',async()=>{
 const db=await database();try{
  await db.exec(fixture);await actor(db);
  const template=await scalar(db,"select qb_save_task_template(task,'Weekly checks',7,gen_random_uuid()) from qa_ids");
  assert.deepEqual(await scalar(db,`select checklist from qb_task_templates where id='${template}'`),['QA objective']);
  await db.exec("update qb_checklist set title='Changed original' where id=(select item from qa_ids)");
  const request=await scalar(db,'select gen_random_uuid()');
  const create=(id=request,pre='null')=>`select qb_create_template_task('${template}','${id}','Fresh task','Outcome','high','2026-12-01',null,30,${pre})`;
  assert.equal(await scalar(db,create()),request);assert.equal(await scalar(db,create()),request);
  assert.equal(await scalar(db,`select count(*) from qb_checklist where task_id='${request}'`),1);
  assert.equal(await scalar(db,`select title from qb_checklist where task_id='${request}'`),'QA objective');
  assert.equal(await scalar(db,`select done from qb_checklist where task_id='${request}'`),false);
  const retry=await scalar(db,'select gen_random_uuid()');
  await deny(db,create(retry,'gen_random_uuid()'),'42501');
  assert.equal(await scalar(db,`select count(*) from qb_tasks where id='${retry}'`),0);
  await deny(db,`update qb_tasks set source_template_id=null where id='${request}'`,'42501');
  await db.exec(`update qb_task_templates set archived=true where id='${template}'`);
  assert.equal(await scalar(db,create()),request);
  await deny(db,create(retry),'55000');
  await db.exec(`update qb_task_templates set archived=false where id='${template}'`);
  assert.equal(await scalar(db,create(retry)),retry);
  await actor(db,'viewer');assert.equal(await scalar(db,'select count(*) from qb_task_templates'),0);
  await deny(db,create(),'42501');await deny(db,"select qb_save_task_template(task,'No',0,gen_random_uuid()) from qa_ids",'42501');
  await actor(db);
  await db.exec("reset role;update qb_tasks set visibility='restricted' where id=(select task from qa_ids)");
  await actor(db);await deny(db,"select qb_save_task_template(task,'Private',0,gen_random_uuid()) from qa_ids",'42501');
  await db.exec("reset role;update qb_org_members set status='suspended' where user_id=(select admin from qa_ids) and org_id=(select org from qa_ids)");
  await actor(db);assert.equal(await scalar(db,'select count(*) from qb_task_templates'),0);await deny(db,create(),'42501');
  await db.exec('reset role;set local role anon');await deny(db,'select * from qb_task_templates','42501');
 }finally{await db.exec('rollback');await db.close();}
});
