const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
const manage=(type,scope,user,action,role,oldRole,status='active')=>`select public.qb_manage_membership('${type}',(select ${scope} from qa_ids),(select ${user} from qa_ids),'${action}',${role?`'${role}'`:'null'},${oldRole?`'${oldRole}'`:'null'},'${status}')`;
async function actor(db,who){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true)`);}
async function scalar(db,sql){return Object.values((await db.query(sql)).rows[0])[0];}
async function deny(db,sql,code){await db.exec('savepoint denied');try{await assert.rejects(db.exec(sql),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
test('Owners delegate ownership, protect the final owner and reject admin escalation',async()=>{
 const db=await database();try{
 await db.exec(fixture+`update public.qb_org_members set is_owner=true where user_id=(select admin from qa_ids) and org_id=(select org from qa_ids);`);await actor(db,'admin');
 await deny(db,manage('organization','org','admin','role','member','owner'),'23514');
 await deny(db,manage('organization','org','admin','remove',null,'owner'),'23514');
 await db.exec(manage('organization','org','viewer','role','owner','member'));
 assert.equal(await scalar(db,"select role from public.qb_membership_directory('organization',(select org from qa_ids)) where user_id=(select viewer from qa_ids)"),'owner');
 await actor(db,'reserve');
 await deny(db,manage('organization','org','reserve','role','owner','admin'),'42501');
 await deny(db,manage('organization','org','viewer','remove',null,'owner'),'42501');
 await deny(db,`update public.qb_org_members set is_owner=true where user_id=(select reserve from qa_ids)`,'42501');
 await deny(db,`select qb_private.manage_membership_legacy('organization',(select org from qa_ids),(select viewer from qa_ids),'suspend',null,'admin','active')`,'42501');
 await actor(db,'admin');await db.exec(manage('organization','org','admin','role','admin','owner'));
 await deny(db,manage('organization','org','viewer','role','admin','owner'),'42501');
 await actor(db,'viewer');assert.equal(await scalar(db,"select count(*)::int from public.qb_membership_events where after_data->>'is_owner'='true'"),2);
 await deny(db,manage('organization','other_org','admin','role','owner','member'),'42501');
 }finally{await db.close();}
});
test('Organization removal clears access and reservations, preserves work and cannot revive old scope grants',async()=>{
 const db=await database();try{
 await db.exec(fixture+`update public.qb_org_members set is_owner=true where user_id=(select admin from qa_ids) and org_id=(select org from qa_ids);
 insert into public.qb_project_members(project_id,user_id,role) select project,viewer,'contributor' from qa_ids;
 update public.qb_tasks set assignee_id=(select viewer from qa_ids);
 insert into public.qb_task_participants(task_id,user_id) select task,viewer from qa_ids;
 insert into public.qb_reward_settings(org_id,coins_enabled) select org,true from qa_ids;
 insert into public.qb_reward_ledger(org_id,user_id,kind,coins,idempotency_key,reason) select org,viewer,'recognition',100,'seed','Test recognition' from qa_ids;
 insert into public.qb_reward_catalog(id,org_id,name,category,price,stock,created_by) select item,org,'Gift','organization',20,1,admin from qa_ids;`);
 await actor(db,'viewer');await db.exec(`select public.qb_redeem_reward(org,item,gen_random_uuid()) from qa_ids`);
 await actor(db,'admin');await db.exec(manage('organization','org','viewer','remove',null,'member'));
 assert.equal(await scalar(db,'select count(*)::int from public.qb_org_members where user_id=(select viewer from qa_ids)'),0);
 assert.equal(await scalar(db,'select count(*)::int from public.qb_department_members where user_id=(select viewer from qa_ids)'),0);
 assert.equal(await scalar(db,'select count(*)::int from public.qb_project_members where user_id=(select viewer from qa_ids)'),0);
 assert.equal(await scalar(db,'select count(*)::int from public.qb_task_participants where user_id=(select viewer from qa_ids)'),0);
 assert.equal(await scalar(db,'select assignee_id=(select viewer from qa_ids) from public.qb_tasks'),true);
 assert.equal(await scalar(db,'select sum(coins)::int from public.qb_reward_ledger where user_id=(select viewer from qa_ids)'),100);
 assert.equal(await scalar(db,'select status from public.qb_reward_redemptions'),'canceled');
 await actor(db,'viewer');assert.equal(await scalar(db,'select qb_private.can_view_project(project) from qa_ids'),false);
 await db.exec(`reset role;insert into public.qb_org_members(org_id,user_id,role) select org,viewer,'member' from qa_ids`);
 await actor(db,'viewer');assert.equal(await scalar(db,'select qb_private.can_view_project(project) from qa_ids'),false);
 }finally{await db.close();}
});
test('Department removal clears child access while retaining organization membership and last-manager guards',async()=>{
 const db=await database();try{
 await db.exec(fixture+`insert into public.qb_project_members(project_id,user_id,role) select project,viewer,'viewer' from qa_ids;`);
 await actor(db,'admin');await db.exec(manage('department','dept','viewer','remove',null,'viewer'));
 assert.equal(await scalar(db,'select count(*)::int from public.qb_project_members where user_id=(select viewer from qa_ids)'),0);
 assert.equal(await scalar(db,'select count(*)::int from public.qb_org_members where user_id=(select viewer from qa_ids)'),1);
 await db.exec(manage('department','dept','reserve','remove',null,'manager'));
 await deny(db,manage('department','dept','admin','remove',null,'manager'),'23514');
 await deny(db,manage('department','dept','viewer','remove',null,'viewer'),'40001');
 }finally{await db.close();}
});
test('New organizations give their verified creator ownership',async()=>{
 const db=await database();try{await db.exec(fixture);await actor(db,'viewer');await db.exec("select public.qb_create_organization('Owned company',gen_random_uuid())");assert.equal(await scalar(db,"select is_owner from public.qb_org_members m join public.qb_organizations o on o.id=m.org_id where o.name='Owned company'"),true);}finally{await db.close();}
});
