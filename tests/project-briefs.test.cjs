const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./database-helper.cjs');
const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
async function actor(db,who='admin'){await db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);}
async function deny(db,query,code='42501'){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(query),e=>{assert.equal(e.code,code,e.message);return true;});}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
test('Project check-ins have scoped reads, manager-only inserts and immutable history',async()=>{
  const db=await database();try{
    await db.exec(fixture);await actor(db);
    const insert=who=>`insert into qb_project_briefs(project_id,author_id,health,accomplishments) select project,${who},'on_track','Completed a milestone' from qa_ids`;
    await db.exec(insert('admin'));
    let r=await db.query('select count(*)::int as count from qb_project_briefs');assert.equal(r.rows[0].count,1);
    await deny(db,"update qb_project_briefs set health='blocked'");
    await deny(db,'delete from qb_project_briefs');
    await actor(db,'viewer');
    r=await db.query('select count(*)::int as count from qb_project_briefs');assert.equal(r.rows[0].count,1);
    await deny(db,insert('viewer'));
    await actor(db);
    await deny(db,"insert into qb_project_briefs(project_id,author_id,health,accomplishments) select project,admin,'on_track','' from qa_ids",'23514');
    await db.exec("reset role;insert into qb_organizations(name) values('Unrelated organization')");
    const foreignOrg=(await db.query("select id from qb_organizations where name='Unrelated organization'")).rows[0].id;
    const foreignDept=(await db.query(`insert into qb_departments(org_id,name) values('${foreignOrg}','Unrelated') returning id`)).rows[0].id;
    const foreignUser=(await db.query("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'foreign@example.invalid',now()) returning id")).rows[0].id;
    await db.exec(`insert into qb_org_members(org_id,user_id,role) values('${foreignOrg}','${foreignUser}','admin')`);
    const other=(await db.query(`insert into qb_projects(org_id,department_id,title,created_by) values('${foreignOrg}','${foreignDept}','Other project','${foreignUser}') returning id`)).rows[0].id;
    await actor(db);
    r=await db.query('select count(*)::int as count from qb_project_briefs');assert.equal(r.rows[0].count,1);
    r=await db.query(`select qb_private.can_view_project('${other}') as visible,qb_private.can_manage_project('${other}') as manageable`);
    assert.equal(r.rows[0].visible,false);assert.equal(r.rows[0].manageable,false);
    await deny(db,`insert into qb_project_briefs(project_id,author_id,health,accomplishments) select '${other}',admin,'on_track','Other' from qa_ids`);
    await db.exec('reset role;set local role anon');await deny(db,'select * from qb_project_briefs');
  }finally{await db.exec('rollback');await db.close();}
});
