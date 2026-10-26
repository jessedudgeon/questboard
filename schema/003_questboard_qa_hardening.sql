-- QA fixes: fail closed for nullable assignments, enforce organization scope.

create or replace function public.qb_transition_task(p_task uuid,p_new_status text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.qb_tasks%rowtype; manager_allowed boolean; actor uuid := (select auth.uid());
begin
  if p_new_status is null then raise exception 'Status is required'; end if;
  if actor is null then raise exception 'Sign in required'; end if;
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
  if p_new_status='in_review' and exists(select 1 from public.qb_checklist c where c.task_id=t.id and not c.done) then raise exception 'Finish the checklist first'; end if;
  update public.qb_tasks set status=p_new_status,updated_at=now(),completed_at=case when p_new_status='complete' then now() else null end where id=p_task;
  insert into public.qb_task_events(task_id,actor_id,event_type,before_data,after_data) values(p_task,actor,'status',jsonb_build_object('status',t.status),jsonb_build_object('status',p_new_status));
  if p_new_status='complete' and t.assignee_id is not null then
    insert into public.qb_xp_events(task_id,user_id,amount) values(t.id,t.assignee_id,t.xp_reward) on conflict(task_id) do nothing;
  end if;
end;
$$;

create or replace function public.qb_toggle_checklist(p_item uuid,p_done boolean) returns void language plpgsql security definer set search_path = '' as $$
declare t public.qb_tasks%rowtype; actor uuid := (select auth.uid());
begin
  if actor is null or p_done is null then raise exception 'Not authorized'; end if;
  select task.* into t from public.qb_tasks task join public.qb_checklist c on c.task_id=task.id where c.id=p_item;
  if not found or not qb_private.can_view_task(t.id) or not (coalesce(t.assignee_id=actor,false) or qb_private.can_manage_project(t.project_id)) then raise exception 'Not authorized'; end if;
  if t.status in ('complete','cancelled') then raise exception 'Task is closed'; end if;
  update public.qb_checklist set done=p_done where id=p_item;
  insert into public.qb_task_events(task_id,actor_id,event_type,after_data) values(t.id,actor,'checklist',jsonb_build_object('item_id',p_item,'done',p_done));
end;
$$;

create or replace function qb_private.is_department_manager(p_dept uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.qb_departments d where d.id=p_dept
 and qb_private.is_org_member(d.org_id)
 and (qb_private.is_org_admin(d.org_id) or exists(
 select 1 from public.qb_department_members m where m.department_id=p_dept
 and m.user_id=(select auth.uid()) and m.role='manager' and m.status='active')));
$$;

drop policy qb_project_insert on public.qb_projects;
create policy qb_project_insert on public.qb_projects for insert to authenticated with check (qb_private.is_department_manager(department_id) and created_by=(select auth.uid()) and exists(select 1 from public.qb_departments d where d.id=department_id and d.org_id=qb_projects.org_id));

drop policy qb_inv_insert on public.qb_invitations;
create policy qb_inv_insert on public.qb_invitations for insert to authenticated with check (qb_private.is_org_admin(org_id) and created_by=(select auth.uid()) and status='pending' and (
  (scope_type='organization' and scope_id is null and invite_role='member') or
  (scope_type='department' and scope_id is not null and invite_role in ('department_manager','department_contributor','department_viewer') and exists(select 1 from public.qb_departments d where d.id=scope_id and d.org_id=qb_invitations.org_id)) or
  (scope_type='project' and scope_id is not null and invite_role in ('project_lead','project_contributor','project_viewer') and exists(select 1 from public.qb_projects p where p.id=scope_id and p.org_id=qb_invitations.org_id))
));

create or replace function public.qb_accept_invitation(p_invitation uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.qb_invitations%rowtype; actor uuid := (select auth.uid()); actor_email text; dept uuid;
begin
  if actor is null then raise exception 'Sign in required'; end if;
  select email into actor_email from auth.users where id=actor and email_confirmed_at is not null;
  if actor_email is null then raise exception 'A verified email is required'; end if;
  select * into i from public.qb_invitations where id=p_invitation for update;
  if not found or i.status<>'pending' or i.expires_at<=now() or lower(i.invited_email)<>lower(actor_email) then raise exception 'Invitation is invalid or expired'; end if;
  if i.scope_type='department' and not exists(select 1 from public.qb_departments d where d.id=i.scope_id and d.org_id=i.org_id) then raise exception 'Invalid invitation scope'; end if;
  if i.scope_type='project' and not exists(select 1 from public.qb_projects p where p.id=i.scope_id and p.org_id=i.org_id) then raise exception 'Invalid invitation scope'; end if;
  insert into public.qb_org_members(org_id,user_id,role,status) values(i.org_id,actor,'member','active')
    on conflict(org_id,user_id) do update set status='active';
  if i.scope_type='department' then
    insert into public.qb_department_members(department_id,user_id,role,status) values(i.scope_id,actor,replace(i.invite_role,'department_',''),'active')
      on conflict(department_id,user_id) do update set status='active',role=case
        when public.qb_department_members.role='manager' or excluded.role='manager' then 'manager'
        when public.qb_department_members.role='contributor' or excluded.role='contributor' then 'contributor'
        else 'viewer' end;
  elsif i.scope_type='project' then
    select department_id into dept from public.qb_projects where id=i.scope_id;
    insert into public.qb_project_members(project_id,user_id,role,status) values(i.scope_id,actor,replace(i.invite_role,'project_',''),'active')
      on conflict(project_id,user_id) do update set status='active',role=case
        when public.qb_project_members.role='lead' or excluded.role='lead' then 'lead'
        when public.qb_project_members.role='contributor' or excluded.role='contributor' then 'contributor'
        else 'viewer' end;
  end if;
  update public.qb_invitations set status='accepted',accepted_by=actor,accepted_at=now() where id=i.id;
  return i.org_id;
end;
$$;

-- Existing execute grants are retained by CREATE OR REPLACE; anonymous access remains revoked.
revoke all on function public.qb_transition_task(uuid,text),public.qb_toggle_checklist(uuid,boolean),public.qb_accept_invitation(uuid) from public,anon;
create index if not exists qb_checklist_task_id_idx on public.qb_checklist(task_id);
create index if not exists qb_task_events_task_id_created_at_idx on public.qb_task_events(task_id,created_at desc);
