-- Automatically make the authorized project creator a project lead.
create function qb_private.add_project_creator() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.qb_project_members(project_id,user_id,role,status)
  values(new.id,new.created_by,'lead','active')
  on conflict(project_id,user_id) do nothing;
  return new;
end;
$$;
create trigger qb_project_creator after insert on public.qb_projects
for each row execute function qb_private.add_project_creator();

-- Metadata changes are recorded separately from controlled status transitions.
create function qb_private.audit_task_metadata() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.title,old.description,old.priority,old.assignee_id,old.reviewer_id,old.due_date,old.xp_reward)
      is distinct from
     (new.title,new.description,new.priority,new.assignee_id,new.reviewer_id,new.due_date,new.xp_reward) then
    insert into public.qb_task_events(task_id,actor_id,event_type,before_data,after_data)
    values(old.id,(select auth.uid()),'metadata',
      jsonb_build_object('title',old.title,'priority',old.priority,'assignee',old.assignee_id,'due',old.due_date),
      jsonb_build_object('title',new.title,'priority',new.priority,'assignee',new.assignee_id,'due',new.due_date));
  end if;
  return new;
end;
$$;
create trigger qb_task_metadata_audit after update on public.qb_tasks
for each row execute function qb_private.audit_task_metadata();

-- Restrict invitation edits to a revocation function; prevent scope mutation.
revoke update on public.qb_invitations from authenticated;
drop policy qb_inv_update on public.qb_invitations;
create function public.qb_revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.qb_invitations%rowtype;
begin
  select * into inv from public.qb_invitations where id=p_invitation for update;
  if not found or not qb_private.is_org_admin(inv.org_id) then raise exception 'Not authorized'; end if;
  if inv.status<>'pending' then raise exception 'Invitation is no longer pending'; end if;
  update public.qb_invitations set status='revoked' where id=p_invitation;
end;
$$;
revoke all on function public.qb_revoke_invitation(uuid) from public, anon;
grant execute on function public.qb_revoke_invitation(uuid) to authenticated;
