const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);}
async function scalar(db,q){return Object.values((await db.query(q)).rows[0])[0];}
async function deny(db,q,code){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(q),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
const save=(rev,title='Updated',status='paused')=>`select qb_save_project_settings(project,${rev},'${title}','Outcome','${status}','2027-01-01') from qa_ids`;
test('Project settings record immutable changes, reject stale edits, and leave task workflow untouched',async()=>{const db=await database();try{
 await db.exec(fixture);await actor(db);assert.equal(await scalar(db,save(1)),2);
 let row=(await db.query('select * from qb_project_changes')).rows[0];assert.equal(row.before_data.title,'QA');assert.equal(row.after_data.title,'Updated');assert.equal(row.revision,2);assert.equal(row.actor_id,await scalar(db,'select admin from qa_ids'));
 assert.equal(await scalar(db,save(2)),2);assert.equal(await scalar(db,'select count(*) from qb_project_changes'),1);
 await deny(db,save(1,'Stale'),'40001');assert.equal(await scalar(db,'select title from qb_projects where id=(select project from qa_ids)'),'Updated');
 for(const [revision,status] of [[2,'archived'],[3,'active'],[4,'complete'],[5,'planned']])assert.equal(await scalar(db,save(revision,'Updated',status)),revision+1);
 assert.equal(await scalar(db,'select status from qb_tasks where id=(select task from qa_ids)'),'backlog');
 await deny(db,'update qb_projects set revision=1 where id=(select project from qa_ids)','42501');
 await deny(db,'delete from qb_project_changes','42501');await deny(db,"update qb_project_changes set after_data='{}'",'42501');
 await deny(db,save(6,''),'22023');await deny(db,save(6,'Valid','fake'),'22023');await deny(db,save('null'),'40001');
 await db.exec("update qb_projects set title='Direct edit' where id=(select project from qa_ids)");assert.equal(await scalar(db,'select revision from qb_projects where id=(select project from qa_ids)'),7);assert.equal(await scalar(db,'select count(*) from qb_project_changes'),6);
 }finally{await db.exec('rollback');await db.close();}});
test('Settings require visible managed projects; history follows current project access',async()=>{const db=await database();try{
 await db.exec(fixture);await actor(db);await db.exec(save(1));await actor(db,'viewer');await deny(db,save(2),'42501');assert.equal(await scalar(db,'select count(*) from qb_project_changes'),1);
 await deny(db,"insert into qb_project_changes(project_id,revision,before_data,after_data) select project,99,'{}','{}' from qa_ids",'42501');
 await db.exec("reset role;update qb_projects set visibility='restricted' where id=(select project from qa_ids)");await actor(db,'viewer');assert.equal(await scalar(db,'select count(*) from qb_project_changes'),0);
 await actor(db,'reserve');await deny(db,save(3),'42501');assert.equal(await scalar(db,'select count(*) from qb_project_changes'),0);
 await db.exec("reset role;update qb_projects set visibility='department' where id=(select project from qa_ids);update qb_org_members set status='suspended' where user_id=(select admin from qa_ids) and org_id=(select org from qa_ids)");await actor(db);await deny(db,save(3),'42501');assert.equal(await scalar(db,'select count(*) from qb_project_changes'),0);
 await db.exec('reset role;set local role anon');await deny(db,'select * from qb_project_changes','42501');await deny(db,"select qb_save_project_settings(null,1,'A','','active',null)",'42501');
 }finally{await db.exec('rollback');await db.close();}});
