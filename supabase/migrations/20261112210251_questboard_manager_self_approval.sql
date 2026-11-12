begin;
-- Scoped leads and department managers may approve their own work.
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
    (t.status='in_review' and p_new_status='complete' and (manager_allowed or coalesce(t.reviewer_id=actor,false)) and (manager_allowed or actor<>coalesce(t.assignee_id,'00000000-0000-0000-0000-000000000000'::uuid))) or
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
