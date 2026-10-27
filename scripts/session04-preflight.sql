-- Read-only aggregate checks; review zero-lead scopes rather than inventing grants.
select 'organizations_without_active_admin' finding,count(*) affected from public.qb_organizations o
where not exists(select 1 from public.qb_org_members m where m.org_id=o.id and m.role='admin' and m.status='active')
union all
select 'departments_without_active_explicit_manager',count(*) from public.qb_departments d
where not exists(select 1 from public.qb_department_members dm join public.qb_org_members om on om.org_id=d.org_id and om.user_id=dm.user_id and om.status='active'
 where dm.department_id=d.id and dm.role='manager' and dm.status='active')
union all
select 'projects_without_manager_with_access',count(*) from public.qb_projects p
where not exists(select 1 from public.qb_org_members om where om.org_id=p.org_id and om.status='active'
 and (exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=om.user_id and pm.status='active')
 or (p.visibility='department' and exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=om.user_id and dm.status='active')))
 and (exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=om.user_id and pm.role='lead' and pm.status='active')
 or exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=om.user_id and dm.role='manager' and dm.status='active')));
