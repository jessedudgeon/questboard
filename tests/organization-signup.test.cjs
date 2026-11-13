const test=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./database-helper.cjs');
const a='a0000000-0000-0000-0000-000000000001',b='a0000000-0000-0000-0000-000000000002',unverified='a0000000-0000-0000-0000-000000000003',request='b0000000-0000-0000-0000-000000000001';
test('Organization bootstrap verifies identity, atomically grants admin and isolates organizations',async()=>{
 const db=await database();try{
 await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${a}','a@example.invalid',now()),('${b}','b@example.invalid',now()),('${unverified}','c@example.invalid',null);`);
 const as=async(id)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);
 await db.exec('set role anon');await assert.rejects(db.query('select public.qb_create_organization($1,$2)',['Acme',request]),/permission denied/);
 await as(unverified);await assert.rejects(db.query('select public.qb_create_organization($1,$2)',['Acme',request]),/verified email/);
 await as(a);await assert.rejects(db.query('select public.qb_create_organization($1,$2)',[' ',request]),/between 2 and 120/);
 await assert.rejects(db.query('select public.qb_create_organization($1,$2)',['A'.repeat(121),request]),/between 2 and 120/);
 const org=(await db.query('select public.qb_create_organization($1,$2) id',[' Acme ',request])).rows[0].id;
 assert.equal((await db.query('select public.qb_create_organization($1,$2) id',['Acme',request])).rows[0].id,org);
 assert.deepEqual((await db.query('select name from public.qb_organizations')).rows,[{name:'Acme'}]);
 assert.deepEqual((await db.query('select role,status from public.qb_org_members')).rows,[{role:'admin',status:'active'}]);
 await db.query('insert into public.qb_departments(org_id,name) values($1,$2)',[org,'IT']);
 assert.equal((await db.query('select count(*)::int n from public.qb_departments')).rows[0].n,1);
 await assert.rejects(db.query("insert into public.qb_organizations(name) values('Bypass')"),/permission denied/);
 await as(b);assert.equal((await db.query('select count(*)::int n from public.qb_organizations')).rows[0].n,0);
 await assert.rejects(db.query('insert into public.qb_departments(org_id,name) values($1,$2)',[org,'Unauthorized']),/row-level security/);
 const other=(await db.query('select public.qb_create_organization($1,$2) id',['Acme',request])).rows[0].id;assert.notEqual(org,other);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.qb_organizations')).rows[0].n,2);
 assert.equal((await db.query("select count(*)::int n from public.qb_membership_events where scope_type='organization' and after_data->>'role'='admin'")).rows[0].n,2);
 // A replay never resurrects suspended or demoted privileges.
 await db.query("insert into public.qb_org_members(org_id,user_id,role,is_owner) values($1,$2,'admin',true)",[org,b]);
 await db.query("update public.qb_org_members set is_owner=false,status='suspended' where org_id=$1 and user_id=$2",[org,a]);
 await as(a);await assert.rejects(db.query('select public.qb_create_organization($1,$2)',['Acme',request]),/access changed/);
 }finally{await db.close();}
});
