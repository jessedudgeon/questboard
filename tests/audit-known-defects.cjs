// Diagnostic reproductions of the Session 1 baseline, NOT desired behavior.
// Run explicitly; remove/convert each probe to a denial regression when repaired.
const fs=require('node:fs');
const {database}=require('./database-helper.cjs');
(async()=>{
 const db=await database();
 const fixture=fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0];
 const admin="set local role authenticated; select set_config('request.jwt.claim.sub',(select admin::text from qa_ids),true);";
 async function probe(name,setup,sql){
  await db.exec(fixture+setup+admin+sql);
  console.log('REPRODUCED:',name);
  await db.exec('reset role; rollback;');
 }
 try{
  await probe('F01: direct INSERT bypasses review and completion event', '', `
   insert into public.qb_tasks(project_id,title,status,created_by,completed_at)
    select project,'Bypassed review','complete',admin,now() from qa_ids;
   do $$ begin if not exists(select 1 from public.qb_tasks where title='Bypassed review' and status='complete') then raise exception 'Not reproduced'; end if; end $$;`);
  await probe('F02: manager directly edits closed checklist without RPC',
   "update public.qb_tasks set status='complete' where id=(select task from qa_ids);",`
   update public.qb_checklist set done=true where id=(select item from qa_ids);
   do $$ begin if not exists(select 1 from public.qb_checklist where id=(select item from qa_ids) and done) then raise exception 'Not reproduced'; end if; end $$;`);
  await probe('F03: pending invitation reactivates suspended organization member',`
   insert into public.qb_invitations(org_id,invited_email,scope_type,invite_role,created_by)
   select org,'questboard-viewer-'||viewer||'@example.invalid','organization','member',admin from qa_ids;
   update public.qb_org_members set status='suspended' where user_id=(select viewer from qa_ids);`, `
   select set_config('request.jwt.claim.sub',(select viewer::text from qa_ids),true);
   select public.qb_accept_invitation(id) from public.qb_my_invitations();
   do $$ begin if not exists(select 1 from public.qb_org_members where user_id=(select viewer from qa_ids) and status='active') then raise exception 'Not reproduced'; end if; end $$;`);
  await probe('F04: non-admin cannot read colleague profile in own department',`
   insert into public.qb_profiles(user_id,display_name) select admin,'Manager' from qa_ids union all select viewer,'Viewer' from qa_ids;`, `
   select set_config('request.jwt.claim.sub',(select viewer::text from qa_ids),true);
   do $$ begin if exists(select 1 from public.qb_profiles where user_id=(select admin from qa_ids)) then raise exception 'Not reproduced'; end if; end $$;`);
  await probe('F05: department can move organizations leaving mismatched projects',`
   update public.qb_org_members set role='admin' where user_id=(select admin from qa_ids);`, `
   update public.qb_departments set org_id=(select other_org from qa_ids) where id=(select dept from qa_ids);
   reset role;
   do $$ begin if not exists(select 1 from public.qb_projects p join public.qb_departments d on d.id=p.department_id where p.org_id<>d.org_id) then raise exception 'Not reproduced'; end if; end $$;`);
 } finally {await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
