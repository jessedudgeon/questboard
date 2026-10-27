-- Read-only. Run against the shared project before reviewing/applying Session 2.
-- No user identities, email addresses, meeting payloads, or credentials are returned.
select 'project_department_org_mismatch' as check_name,count(*) as violations
from public.qb_projects p join public.qb_departments d on d.id=p.department_id where p.org_id<>d.org_id
union all
select 'complete_without_completed_at',count(*) from public.qb_tasks where status='complete' and completed_at is null
union all
select 'review_or_complete_with_incomplete_checklist',count(*)
from public.qb_tasks t join public.qb_checklist c on c.task_id=t.id
where t.status in ('in_review','complete') and not c.done
union all
select 'pending_invites_for_suspended_members',count(*)
from public.qb_invitations i join auth.users u on lower(u.email)=lower(i.invited_email)
where i.status='pending' and (
 exists(select 1 from public.qb_org_members m where m.org_id=i.org_id and m.user_id=u.id and m.status='suspended')
 or (i.scope_type='department' and exists(select 1 from public.qb_department_members m where m.department_id=i.scope_id and m.user_id=u.id and m.status='suspended'))
 or (i.scope_type='project' and exists(select 1 from public.qb_project_members m where m.project_id=i.scope_id and m.user_id=u.id and m.status='suspended')));

select c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and (c.relname like 'qb_%' or c.relname='meeting_workspaces')
order by c.relname;
