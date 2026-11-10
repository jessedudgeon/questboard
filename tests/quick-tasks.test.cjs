const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function scalar(db,q){return Object.values((await db.query(q)).rows[0])[0];}
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);}
async function denied(db,q){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(q));}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
test('Quick tasks reuse one department queue, retain review XP, and reject unauthorized scopes and retries',async()=>{
 const db=await database();try{
 await db.exec(fixture);await actor(db);
 const request=await scalar(db,'select gen_random_uuid()');
 const create=(project='null',department='dept',id=request)=>`select qb_create_quick_task('${id}',${project},${department},'Quick follow-up','Minutes action',null,null,15) from qa_ids`;
 assert.equal(await scalar(db,create()),request);assert.equal(await scalar(db,create()),request);
 assert.equal(await scalar(db,'select count(*) from qb_projects where is_quick_queue'),1);
 assert.equal(await scalar(db,`select count(*) from qb_tasks where id='${request}'`),1);
 assert.equal(await scalar(db,`select count(*) from qb_xp_events where task_id='${request}'`),0);
 const another=await scalar(db,'select gen_random_uuid()');await scalar(db,create('null','dept',another));
 assert.equal(await scalar(db,'select count(*) from qb_projects where is_quick_queue'),1);
 await denied(db,create('project','null'));await denied(db,create('null','other_dept'));
 const projectTask=await scalar(db,'select gen_random_uuid()');await scalar(db,create('project','null',projectTask));
 await actor(db,'viewer');assert.equal(await scalar(db,'select count(*) from qb_quick_destinations()'),0);await denied(db,create());
 await actor(db);await db.exec(`reset role;update qb_org_members set status='suspended' where user_id=(select admin from qa_ids) and org_id=(select org from qa_ids)`);await actor(db);await denied(db,create());
 await db.exec('reset role;set local role anon');await denied(db,'select * from qb_quick_destinations()');
 }finally{await db.exec('rollback');await db.close();}
});
