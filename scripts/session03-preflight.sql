-- Read-only counts. Run before review/deployment; no names, emails, or row identifiers.
-- Existing stale references are retained by the migration, never silently repaired.
with project_access as (
 select p.id project_id,om.user_id from public.qb_projects p
 join public.qb_org_members om on om.org_id=p.org_id and om.status='active'
 where exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=om.user_id and pm.status='active')
 or (p.visibility='department' and exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=om.user_id and dm.status='active'))
), assignments as (
 select t.id,t.project_id,t.visibility,x.kind,x.user_id from public.qb_tasks t
 cross join lateral (values ('assignee',t.assignee_id),('reviewer',t.reviewer_id)) x(kind,user_id)
 where x.user_id is not null
)
select 'ineligible_'||a.kind finding,count(*) affected from assignments a
where not exists(select 1 from project_access pa where pa.project_id=a.project_id and pa.user_id=a.user_id)
or (a.visibility='restricted' and not exists(select 1 from public.qb_task_participants tp where tp.task_id=a.id and tp.user_id=a.user_id))
group by a.kind
union all
select 'participants_without_project_access',count(*) from public.qb_task_participants tp
join public.qb_tasks t on t.id=tp.task_id
where not exists(select 1 from project_access pa where pa.project_id=t.project_id and pa.user_id=tp.user_id)
union all
select 'active_department_members_without_active_org',count(*) from public.qb_department_members dm
join public.qb_departments d on d.id=dm.department_id
where dm.status='active' and not exists(select 1 from public.qb_org_members om where om.org_id=d.org_id and om.user_id=dm.user_id and om.status='active')
union all
select 'active_project_members_without_active_org',count(*) from public.qb_project_members pm
join public.qb_projects p on p.id=pm.project_id
where pm.status='active' and not exists(select 1 from public.qb_org_members om where om.org_id=p.org_id and om.user_id=pm.user_id and om.status='active');
