-- Additive dependency graph; existing tasks/links and MeetingDesk are untouched.
begin;
set local lock_timeout='5s';
alter table public.qb_tasks add constraint qb_tasks_id_project_unique unique(id,project_id);
create table public.qb_task_dependencies (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.qb_projects(id),
 task_id uuid not null,
 prerequisite_id uuid not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(task_id,prerequisite_id),
 check(task_id<>prerequisite_id),
 foreign key(task_id,project_id) references public.qb_tasks(id,project_id),
 foreign key(prerequisite_id,project_id) references public.qb_tasks(id,project_id)
);
create index qb_dependencies_prerequisite_idx on public.qb_task_dependencies(prerequisite_id);
create index qb_dependencies_project_idx on public.qb_task_dependencies(project_id);
create index qb_dependencies_creator_idx on public.qb_task_dependencies(created_by);
alter table public.qb_task_dependencies enable row level security;
revoke all on public.qb_task_dependencies from public,anon,authenticated;
grant select on public.qb_task_dependencies to authenticated;
create policy qb_dependencies_read on public.qb_task_dependencies for select to authenticated
 using(qb_private.can_view_task(task_id) and qb_private.can_view_task(prerequisite_id));

create function qb_private.lock_dependency_project(p_project uuid) returns void
language sql volatile security invoker set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qb-dependencies:'||p_project::text,0));
$$;

-- Every link edit and task transition uses this project lock before reading the graph.
create function public.qb_set_task_dependency(p_task uuid,p_prerequisite uuid,p_link boolean) returns void
language plpgsql security definer set search_path='' as $$
declare t public.qb_tasks%rowtype; prerequisite public.qb_tasks%rowtype; actor uuid:=(select auth.uid()); affected integer;
begin
 if actor is null or p_link is null then raise exception using errcode='42501',message='Sign in required'; end if;
 select * into t from public.qb_tasks where id=p_task;
 if not found or not qb_private.can_view_task(p_task) or not qb_private.can_manage_project(t.project_id) then
  raise exception using errcode='42501',message='Task unavailable'; end if;
 perform qb_private.lock_dependency_project(t.project_id);
 select * into t from public.qb_tasks where id=p_task;
 select * into prerequisite from public.qb_tasks where id=p_prerequisite;
 if not found or not qb_private.can_view_task(p_task) or not qb_private.can_manage_project(t.project_id)
   or not qb_private.can_view_task(p_prerequisite) or prerequisite.project_id<>t.project_id then
  raise exception using errcode='42501',message='Choose an available task in the same project'; end if;
 if t.status in ('complete','cancelled') then raise exception using errcode='55000',message='Reopen the task before changing dependencies'; end if;
 if p_task=p_prerequisite then raise exception using errcode='23514',message='A task cannot depend on itself'; end if;
 if p_link then
  if exists(with recursive ancestors(id) as (
    select p_prerequisite union select d.prerequisite_id from public.qb_task_dependencies d join ancestors a on d.task_id=a.id
   ) select 1 from ancestors where id=p_task) then
   raise exception using errcode='23514',message='This link would create a circular dependency'; end if;
  if t.status in ('in_progress','in_review') and prerequisite.status<>'complete' then
   raise exception using errcode='55000',message='Mark the dependent task blocked before adding an unfinished prerequisite'; end if;
  insert into public.qb_task_dependencies(project_id,task_id,prerequisite_id,created_by)
   values(t.project_id,p_task,p_prerequisite,actor) on conflict(task_id,prerequisite_id) do nothing;
 else
  delete from public.qb_task_dependencies where task_id=p_task and prerequisite_id=p_prerequisite;
 end if;
 get diagnostics affected=row_count;
 if affected>0 then
  -- Generic audit text never leaks a later-hidden prerequisite ID/title through task history.
  insert into public.qb_task_events(task_id,actor_id,event_type,after_data)
   values(p_task,actor,case when p_link then 'dependency_linked' else 'dependency_unlinked' end,
    jsonb_build_object('change',case when p_link then 'Prerequisite linked' else 'Prerequisite removed' end));
 end if;
end;
$$;

-- Only readiness of caller-visible tasks is returned, never hidden endpoint IDs/names.
create function public.qb_dependency_readiness(p_tasks uuid[]) returns table(task_id uuid,waiting boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception using errcode='42501',message='Sign in required'; end if;
 if coalesce(cardinality(p_tasks),0)>100 then raise exception 'Request at most 100 tasks'; end if;
 return query select t.id,exists(select 1 from public.qb_task_dependencies d join public.qb_tasks p on p.id=d.prerequisite_id
   where d.task_id=t.id and p.status<>'complete')
 from public.qb_tasks t where t.id=any(p_tasks) and qb_private.can_view_task(t.id);
end;
$$;

-- Runs even for direct privileged status changes. Authenticated clients still cannot
-- write status directly; the existing transition RPC owns authorization/review/XP.
create function qb_private.guard_dependency_status() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status is not distinct from old.status then return new; end if;
 perform qb_private.lock_dependency_project(new.project_id);
 if new.status in ('in_progress','in_review','complete') and exists(
  select 1 from public.qb_task_dependencies d join public.qb_tasks p on p.id=d.prerequisite_id
  where d.task_id=new.id and p.status<>'complete') then
  raise exception using errcode='55000',message='Finish all prerequisites before starting, resuming, reviewing or completing this task';
 end if;
 if old.status='complete' and new.status<>'complete' and exists(
  select 1 from public.qb_task_dependencies d join public.qb_tasks t on t.id=d.task_id
  where d.prerequisite_id=new.id and t.status in ('in_progress','in_review','complete')) then
  raise exception using errcode='55000',message='Reopen completed dependents and mark active dependents blocked before reopening this prerequisite';
 end if;
 return new;
end;
$$;
create trigger qb_task_dependency_status before update of status on public.qb_tasks
 for each row execute function qb_private.guard_dependency_status();

revoke all on function qb_private.lock_dependency_project(uuid),qb_private.guard_dependency_status() from public,anon,authenticated;
revoke all on function public.qb_set_task_dependency(uuid,uuid,boolean),public.qb_dependency_readiness(uuid[]) from public,anon;
grant execute on function public.qb_set_task_dependency(uuid,uuid,boolean),public.qb_dependency_readiness(uuid[]) to authenticated;

create or replace function public.qb_transition_task(p_task uuid,p_new_status text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.qb_tasks%rowtype; manager_allowed boolean; actor uuid := (select auth.uid());
begin
  if p_new_status is null then raise exception 'Status is required'; end if;
  if actor is null then raise exception 'Sign in required'; end if;
  select * into t from public.qb_tasks where id=p_task;
  if not found or not qb_private.can_view_task(p_task) then raise exception 'Task unavailable'; end if;
  perform qb_private.lock_dependency_project(t.project_id);
  select * into t from public.qb_tasks where id=p_task for update;
  if not found or not qb_private.can_view_task(p_task) then raise exception 'Task unavailable'; end if;
  manager_allowed := qb_private.can_manage_project(t.project_id);
  if not (manager_allowed or coalesce(t.assignee_id=actor,false) or coalesce(t.reviewer_id=actor,false)) then raise exception 'Not assigned to this task'; end if;
  if not (
    (t.status='backlog' and p_new_status='ready' and manager_allowed) or
    (t.status='ready' and p_new_status='in_progress' and (manager_allowed or coalesce(t.assignee_id=actor,false))) or
    (t.status='in_progress' and p_new_status in ('blocked','in_review') and (manager_allowed or coalesce(t.assignee_id=actor,false))) or
    (t.status='blocked' and p_new_status='in_progress' and (manager_allowed or coalesce(t.assignee_id=actor,false))) or
    (t.status='in_review' and p_new_status='in_progress' and (manager_allowed or coalesce(t.reviewer_id=actor,false))) or
    (t.status='in_review' and p_new_status='complete' and (manager_allowed or coalesce(t.reviewer_id=actor,false)) and actor<>coalesce(t.assignee_id,'00000000-0000-0000-0000-000000000000'::uuid)) or
    (t.status='complete' and p_new_status='in_progress' and manager_allowed)
  ) then raise exception 'Invalid or unauthorized status change'; end if;
  if p_new_status in ('in_review','complete') and exists(select 1 from public.qb_checklist c where c.task_id=t.id and not c.done) then raise exception 'Finish the checklist first'; end if;
  update public.qb_tasks set status=p_new_status,updated_at=now(),completed_at=case when p_new_status='complete' then now() else null end where id=p_task;
  insert into public.qb_task_events(task_id,actor_id,event_type,before_data,after_data) values(p_task,actor,'status',jsonb_build_object('status',t.status),jsonb_build_object('status',p_new_status));
  if p_new_status='complete' and t.assignee_id is not null then
    insert into public.qb_xp_events(task_id,user_id,amount) values(t.id,t.assignee_id,t.xp_reward) on conflict(task_id) do nothing;
  end if;
end;
$$;
commit;
