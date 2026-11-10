begin;
set local lock_timeout='5s';
-- Standalone work retains department-scoped authorization through one operations queue.
alter table public.qb_projects add column is_quick_queue boolean not null default false;
create unique index qb_one_quick_queue on public.qb_projects(department_id) where is_quick_queue;
create function public.qb_quick_destinations()
returns table(kind text,id uuid,label text,org_id uuid)
language sql stable security invoker set search_path='' as $$
 select 'department',d.id,'No project · '||o.name||' / '||d.name,d.org_id
 from public.qb_departments d join public.qb_organizations o on o.id=d.org_id
 where qb_private.is_department_manager(d.id)
 union all
 select 'project',p.id,o.name||' / '||p.title,p.org_id
 from public.qb_projects p join public.qb_organizations o on o.id=p.org_id
 where not p.is_quick_queue and qb_private.can_manage_project(p.id) and qb_private.can_view_project(p.id);
$$;
create function public.qb_create_quick_task(
 p_request uuid,p_project uuid,p_department uuid,p_title text,p_description text,
 p_due_date date,p_assignee uuid,p_xp_reward integer
) returns uuid language plpgsql security invoker set search_path='' as $$
declare destination uuid; existing public.qb_tasks%rowtype; department public.qb_departments%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_request is null or (p_project is null)=(p_department is null) then
  raise exception 'Choose a project or department' using errcode='22023'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 160
 or p_description is null or char_length(p_description)>2500 then
  raise exception 'Enter a title (160 characters maximum) and description (2500 maximum)' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-quick:'||p_request::text,0));
 if p_project is not null then
  if not qb_private.can_manage_project(p_project) or not qb_private.can_view_project(p_project) then
   raise exception 'Project unavailable' using errcode='42501'; end if;
  destination:=p_project;
 else
  if not qb_private.is_department_manager(p_department) then raise exception 'Department unavailable' using errcode='42501'; end if;
  select * into department from public.qb_departments where id=p_department;
  if not found then raise exception 'Department unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qb-queue:'||p_department::text,0));
  select id into destination from public.qb_projects where department_id=p_department and is_quick_queue;
  if destination is null then
   destination:=gen_random_uuid();
   insert into public.qb_projects(id,org_id,department_id,title,summary,created_by,is_quick_queue)
   values(destination,department.org_id,department.id,'No project · '||department.name,'Quick tasks without a named project. Visible to this department.',auth.uid(),true);
  end if;
 end if;
 select * into existing from public.qb_tasks where id=p_request;
 if found then
  if existing.created_by<>auth.uid() or existing.project_id<>destination then
   raise exception 'Request already belongs to another task' using errcode='22023'; end if;
  return existing.id;
 end if;
 insert into public.qb_tasks(id,project_id,title,description,due_date,assignee_id,reviewer_id,xp_reward,created_by)
 values(p_request,destination,btrim(p_title),p_description,p_due_date,p_assignee,auth.uid(),p_xp_reward,auth.uid());
 return p_request;
end;
$$;
revoke all on function public.qb_quick_destinations(),public.qb_create_quick_task(uuid,uuid,uuid,text,text,date,uuid,integer) from public,anon;
grant execute on function public.qb_quick_destinations(),public.qb_create_quick_task(uuid,uuid,uuid,text,text,date,uuid,integer) to authenticated;
commit;
