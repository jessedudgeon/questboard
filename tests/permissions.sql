-- Run using a privileged SQL connection. All fixtures roll back, including auth users.
begin;
create temporary table qa_ids as select gen_random_uuid() as admin, gen_random_uuid() as viewer,
 gen_random_uuid() as org,gen_random_uuid() as other_org,gen_random_uuid() as dept,
 gen_random_uuid() as other_dept,gen_random_uuid() as project,gen_random_uuid() as task,gen_random_uuid() as item;
grant select on qa_ids to authenticated;
insert into auth.users(id,email,email_confirmed_at) select admin,'questboard-admin-'||admin||'@example.invalid',now() from qa_ids union all select viewer,'questboard-viewer-'||viewer||'@example.invalid',now() from qa_ids;
insert into public.qb_organizations(id,name) select org,'QA rollback only' from qa_ids union all select other_org,'QA other rollback only' from qa_ids;
insert into public.qb_org_members(org_id,user_id,role) select org,admin,'admin' from qa_ids union all select org,viewer,'member' from qa_ids union all select other_org,admin,'member' from qa_ids;
insert into public.qb_departments(id,org_id,name) select dept,org,'QA' from qa_ids union all select other_dept,other_org,'QA other' from qa_ids;
insert into public.qb_department_members(department_id,user_id,role) select dept,admin,'manager' from qa_ids union all select dept,viewer,'viewer' from qa_ids;
insert into public.qb_projects(id,org_id,department_id,title,created_by) select project,org,dept,'QA',admin from qa_ids;
insert into public.qb_tasks(id,project_id,title,created_by) select task,project,'QA unassigned',admin from qa_ids;
insert into public.qb_checklist(id,task_id,title) select item,task,'QA objective' from qa_ids;
create function pg_temp.must_deny(statement text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then return; end;
  raise exception 'Permission regression: operation unexpectedly allowed: %',statement;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select viewer::text from qa_ids),true);
select pg_temp.must_deny('select public.qb_transition_task(task,''ready'') from qa_ids');
select pg_temp.must_deny('select public.qb_toggle_checklist(item,true) from qa_ids');
select set_config('request.jwt.claim.sub',(select admin::text from qa_ids),true);
-- Cross-organization scope must not pass even if the actor can see both departments.
select pg_temp.must_deny('insert into public.qb_projects(org_id,department_id,title,created_by) select other_org,dept,''Wrong organization'',admin from qa_ids');
select pg_temp.must_deny('insert into public.qb_invitations(org_id,scope_type,scope_id,invite_role,invited_email,created_by) select org,''department'',other_dept,''department_viewer'',''qa@example.invalid'',admin from qa_ids');
-- Client uses return=minimal because new-row SELECT policy runs before membership triggers.
insert into public.qb_projects(org_id,department_id,title,created_by) select org,dept,'QA created through RLS',admin from qa_ids;
insert into public.qb_tasks(project_id,title,created_by) select project,'QA task created through RLS',admin from qa_ids;
do $$ begin
 if not exists(select 1 from public.qb_projects where title='QA created through RLS' and org_id=(select org from qa_ids)) then raise exception 'Created project is not visible after trigger'; end if;
 if not exists(select 1 from public.qb_tasks where title='QA task created through RLS' and project_id=(select project from qa_ids)) then raise exception 'Created task is not visible'; end if;
end $$;
-- Authorized forward path and incomplete-checklist rejection.
select public.qb_transition_task(task,'ready') from qa_ids;
select set_config('request.jwt.claim.sub',(select viewer::text from qa_ids),true);
select pg_temp.must_deny('select public.qb_transition_task(task,''in_progress'') from qa_ids');
select set_config('request.jwt.claim.sub',(select admin::text from qa_ids),true);
select public.qb_transition_task(task,'in_progress') from qa_ids;
select pg_temp.must_deny('select public.qb_transition_task(task,''in_review'') from qa_ids');
select public.qb_toggle_checklist(item,true) from qa_ids;
select public.qb_transition_task(task,'in_review') from qa_ids;
select public.qb_transition_task(task,'complete') from qa_ids;
select pg_temp.must_deny('select public.qb_toggle_checklist(item,false) from qa_ids');
-- Null reviewer must not let an assignee approve their own work or skip states.
select public.qb_transition_task(task,'in_progress') from qa_ids;
update public.qb_tasks set assignee_id=(select viewer from qa_ids),reviewer_id=null where id=(select task from qa_ids);
select set_config('request.jwt.claim.sub',(select viewer::text from qa_ids),true);
select public.qb_transition_task(task,'in_review') from qa_ids;
select pg_temp.must_deny('select public.qb_transition_task(task,''complete'') from qa_ids');
select pg_temp.must_deny('select public.qb_transition_task(task,''ready'') from qa_ids');
select set_config('request.jwt.claim.sub',(select admin::text from qa_ids),true);
select public.qb_transition_task(task,'complete') from qa_ids;
select public.qb_transition_task(task,'in_progress') from qa_ids;
select public.qb_transition_task(task,'in_review') from qa_ids;
select public.qb_transition_task(task,'complete') from qa_ids;
reset role;
do $$ begin
 if (select count(*) from public.qb_xp_events where task_id=(select task from qa_ids))<>1 then raise exception 'XP duplication'; end if;
end $$;
-- Existing members receive additional scoped invitations and role upgrades.
insert into public.qb_invitations(org_id,scope_type,scope_id,invite_role,invited_email,created_by)
 select org,'department',dept,'department_contributor','questboard-viewer-'||viewer||'@example.invalid',admin from qa_ids;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select viewer::text from qa_ids),true);
select public.qb_accept_invitation(id) from public.qb_my_invitations();
reset role;
do $$ begin
 if (select role from public.qb_department_members where department_id=(select dept from qa_ids) and user_id=(select viewer from qa_ids))<>'contributor' then raise exception 'Invitation did not update existing role'; end if;
end $$;
-- Suspended organization members must lose department-manager authority.
update public.qb_org_members set status='suspended' where user_id=(select admin from qa_ids) and org_id=(select org from qa_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin::text from qa_ids),true);
do $$ begin
 if qb_private.is_department_manager((select dept from qa_ids)) then raise exception 'Suspended manager retained authority'; end if;
end $$;
reset role;
rollback;
