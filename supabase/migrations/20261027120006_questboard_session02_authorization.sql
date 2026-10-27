-- Session 2: apply only after the existing 001/002/003 baseline, never replay it.
-- No MeetingDesk objects or auth configuration are changed. See docs/SESSION_02.md.
begin;
set local lock_timeout = '5s';

-- F01: client-created tasks start in backlog; completion is exclusively a workflow RPC.
alter policy qb_tasks_insert on public.qb_tasks with check (
  qb_private.can_manage_project(project_id)
  and created_by=(select auth.uid())
  and status='backlog' and completed_at is null
);

-- F05: clients may rename/recolor departments, not move their identity/hierarchy.
revoke update on public.qb_departments from authenticated;
grant update(name,color) on public.qb_departments to authenticated;
alter table public.qb_departments add constraint qb_departments_id_org_unique unique(id,org_id);
-- Abort atomically on existing mismatches rather than repairing/reparenting data silently.
alter table public.qb_projects add constraint qb_projects_department_org_fk
  foreign key(department_id,org_id) references public.qb_departments(id,org_id);

-- F02: checklist completion goes through the existing authorized RPC.
revoke update on public.qb_checklist from authenticated;
grant update(title,position) on public.qb_checklist to authenticated;

-- Invoker trigger: serializes all checklist writes with task transition's parent lock.
create function qb_private.guard_checklist_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare task_status text;
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.task_id<>old.task_id) then
    raise exception using errcode='23514',message='Checklist identity cannot change';
  end if;
  if tg_op='INSERT' and new.done then
    raise exception using errcode='23514',message='New objectives must start incomplete';
  end if;
  select status into task_status from public.qb_tasks where id=new.task_id for update;
  if not found then raise exception using errcode='42501',message='Task unavailable'; end if;
  if task_status in ('in_review','complete','cancelled') then
    raise exception using errcode='55000',message='Reopen or request changes before editing objectives';
  end if;
  return new;
end;
$$;
create trigger qb_checklist_guard before insert or update on public.qb_checklist
for each row execute function qb_private.guard_checklist_write();

-- Central audit covers the existing direct add/metadata paths as well as RPC completion.
create function qb_private.audit_checklist_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op='UPDATE' and new is not distinct from old then return new; end if;
  insert into public.qb_task_events(task_id,actor_id,event_type,before_data,after_data)
  values(new.task_id,(select auth.uid()),'checklist',
    case when tg_op='UPDATE' then jsonb_build_object('item_id',old.id,'title',old.title,'done',old.done,'position',old.position) else null end,
    jsonb_build_object('item_id',new.id,'title',new.title,'done',new.done,'position',new.position));
  return new;
end;
$$;
create trigger qb_checklist_audit after insert or update on public.qb_checklist
for each row execute function qb_private.audit_checklist_write();

create or replace function public.qb_toggle_checklist(p_item uuid,p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.qb_tasks%rowtype; actor uuid := (select auth.uid());
begin
  if actor is null or p_done is null then raise exception using errcode='42501',message='Not authorized'; end if;
  -- Lock the parent before reading state; same lock as qb_transition_task.
  select task.* into t from public.qb_tasks task join public.qb_checklist c on c.task_id=task.id
    where c.id=p_item for update of task;
  if not found or not qb_private.can_view_task(t.id)
    or not (coalesce(t.assignee_id=actor,false) or qb_private.can_manage_project(t.project_id)) then
    raise exception using errcode='42501',message='Not authorized';
  end if;
  if t.status in ('in_review','complete','cancelled') then
    raise exception using errcode='55000',message='Reopen or request changes before editing objectives';
  end if;
  update public.qb_checklist set done=p_done where id=p_item;
  -- The trigger emits the single audit event.
end;
$$;

-- Completion also validates legacy in-review rows with unfinished objectives.
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
  if p_new_status in ('in_review','complete') and exists(select 1 from public.qb_checklist c where c.task_id=t.id and not c.done) then raise exception 'Finish the checklist first'; end if;
  update public.qb_tasks set status=p_new_status,updated_at=now(),completed_at=case when p_new_status='complete' then now() else null end where id=p_task;
  insert into public.qb_task_events(task_id,actor_id,event_type,before_data,after_data) values(p_task,actor,'status',jsonb_build_object('status',t.status),jsonb_build_object('status',p_new_status));
  if p_new_status='complete' and t.assignee_id is not null then
    insert into public.qb_xp_events(task_id,user_id,amount) values(t.id,t.assignee_id,t.xp_reward) on conflict(task_id) do nothing;
  end if;
end;
$$;

-- F03: acceptance locks authorization rows before the invitation. It never restores
-- suspended memberships. ON CONFLICT predicates also cover concurrent member creation.
create or replace function public.qb_accept_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.qb_invitations%rowtype; actor uuid := (select auth.uid()); actor_email text;
begin
  if actor is null then raise exception using errcode='42501',message='Sign in required'; end if;
  select email into actor_email from auth.users where id=actor and email_confirmed_at is not null;
  if actor_email is null then raise exception using errcode='42501',message='A verified email is required'; end if;
  select * into i from public.qb_invitations where id=p_invitation;
  if not found or i.status<>'pending' or i.expires_at<=clock_timestamp() or lower(i.invited_email)<>lower(actor_email) then
    raise exception using errcode='42501',message='Invitation is invalid or expired';
  end if;
  -- Deterministic order avoids two acceptances locking issuer/recipient in reverse.
  perform 1 from public.qb_org_members where org_id=i.org_id and user_id in (actor,i.created_by)
    order by user_id for update;
  if not exists(select 1 from public.qb_org_members where org_id=i.org_id and user_id=i.created_by and role='admin' and status='active') then
    raise exception using errcode='42501',message='Invitation issuer is no longer authorized';
  end if;
  if exists(select 1 from public.qb_org_members where org_id=i.org_id and user_id=actor and status='suspended') then
    raise exception using errcode='42501',message='Suspended membership requires administrator reinstatement';
  end if;
  if i.scope_type='department' then
    if i.invite_role not in ('department_manager','department_contributor','department_viewer') or not exists(
      select 1 from public.qb_departments where id=i.scope_id and org_id=i.org_id) then
      raise exception using errcode='42501',message='Invalid invitation scope';
    end if;
    perform 1 from public.qb_department_members where department_id=i.scope_id and user_id=actor for update;
    if exists(select 1 from public.qb_department_members where department_id=i.scope_id and user_id=actor and status='suspended') then
      raise exception using errcode='42501',message='Suspended membership requires administrator reinstatement';
    end if;
  elsif i.scope_type='project' then
    if i.invite_role not in ('project_lead','project_contributor','project_viewer') or not exists(
      select 1 from public.qb_projects where id=i.scope_id and org_id=i.org_id) then
      raise exception using errcode='42501',message='Invalid invitation scope';
    end if;
    perform 1 from public.qb_project_members where project_id=i.scope_id and user_id=actor for update;
    if exists(select 1 from public.qb_project_members where project_id=i.scope_id and user_id=actor and status='suspended') then
      raise exception using errcode='42501',message='Suspended membership requires administrator reinstatement';
    end if;
  elsif i.scope_type<>'organization' or i.scope_id is not null or i.invite_role<>'member' then
    raise exception using errcode='42501',message='Invalid invitation scope';
  end if;
  -- Revocation/suspension may have changed the invitation while locks were acquired.
  select * into i from public.qb_invitations where id=p_invitation for update;
  if not found or i.status<>'pending' or i.expires_at<=clock_timestamp() or lower(i.invited_email)<>lower(actor_email) then
    raise exception using errcode='42501',message='Invitation is invalid or expired';
  end if;
  insert into public.qb_org_members(org_id,user_id,role,status) values(i.org_id,actor,'member','active')
    on conflict(org_id,user_id) do update set status='active' where public.qb_org_members.status='active';
  if not found then raise exception using errcode='42501',message='Suspended membership requires administrator reinstatement'; end if;
  if i.scope_type='department' then
    insert into public.qb_department_members(department_id,user_id,role,status)
      values(i.scope_id,actor,replace(i.invite_role,'department_',''),'active')
      on conflict(department_id,user_id) do update set role=case
        when public.qb_department_members.role='manager' or excluded.role='manager' then 'manager'
        when public.qb_department_members.role='contributor' or excluded.role='contributor' then 'contributor'
        else 'viewer' end where public.qb_department_members.status='active';
    if not found then raise exception using errcode='42501',message='Suspended membership requires administrator reinstatement'; end if;
  elsif i.scope_type='project' then
    insert into public.qb_project_members(project_id,user_id,role,status)
      values(i.scope_id,actor,replace(i.invite_role,'project_',''),'active')
      on conflict(project_id,user_id) do update set role=case
        when public.qb_project_members.role='lead' or excluded.role='lead' then 'lead'
        when public.qb_project_members.role='contributor' or excluded.role='contributor' then 'contributor'
        else 'viewer' end where public.qb_project_members.status='active';
    if not found then raise exception using errcode='42501',message='Suspended membership requires administrator reinstatement'; end if;
  end if;
  update public.qb_invitations set status='accepted',accepted_by=actor,accepted_at=now() where id=i.id;
  return i.org_id;
end;
$$;

-- Invalidate pending invitations when membership is suspended. This trigger also
-- runs for privileged administrative suspension (no auth.uid required for enforcement).
create function qb_private.revoke_suspended_member_invitations() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_org uuid; target_scope uuid; target_type text; target_email text;
begin
  if new.status<>'suspended' then return new; end if;
  select email into target_email from auth.users where id=new.user_id;
  if tg_table_name='qb_org_members' then
    target_org:=new.org_id;
  elsif tg_table_name='qb_department_members' then
    target_scope:=new.department_id; target_type:='department';
    select org_id into target_org from public.qb_departments where id=target_scope;
  else
    target_scope:=new.project_id; target_type:='project';
    select org_id into target_org from public.qb_projects where id=target_scope;
  end if;
  update public.qb_invitations set status='revoked' where org_id=target_org and status='pending'
    and lower(invited_email)=lower(target_email)
    and (target_type is null or (scope_type=target_type and scope_id=target_scope));
  return new;
end;
$$;
create trigger qb_org_suspend_invites after insert or update of status on public.qb_org_members
for each row execute function qb_private.revoke_suspended_member_invitations();
create trigger qb_dept_suspend_invites after insert or update of status on public.qb_department_members
for each row execute function qb_private.revoke_suspended_member_invitations();
create trigger qb_project_suspend_invites after insert or update of status on public.qb_project_members
for each row execute function qb_private.revoke_suspended_member_invitations();

revoke all on function qb_private.guard_checklist_write(),qb_private.audit_checklist_write(),
  qb_private.revoke_suspended_member_invitations() from public,anon,authenticated;
revoke all on function public.qb_toggle_checklist(uuid,boolean),public.qb_accept_invitation(uuid) from public,anon;
grant execute on function public.qb_toggle_checklist(uuid,boolean),public.qb_accept_invitation(uuid) to authenticated;
commit;
