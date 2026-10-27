-- Requires the Session 2 migration. No MeetingDesk objects or existing rows rewritten.
begin;
set local lock_timeout='5s';

-- Internal target-user predicate mirrors existing project visibility, including
-- independent active membership paths. Organization suspension overrides all paths.
create function qb_private.user_can_access_project(p_project uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.qb_projects p
 join public.qb_org_members om on om.org_id=p.org_id and om.user_id=p_user and om.status='active'
 where p.id=p_project and (
  exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=p_user and pm.status='active')
  or (p.visibility='department' and exists(select 1 from public.qb_department_members dm
      where dm.department_id=p.department_id and dm.user_id=p_user and dm.status='active'))));
$$;

-- F04: names visible to active collaborators, not all members of the same org.
-- This current-caller helper avoids the membership-table SELECT-policy recursion.
create function qb_private.can_view_profile(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (
  p_user=(select auth.uid())
  or exists(select 1 from public.qb_org_members mine join public.qb_org_members other on other.org_id=mine.org_id
    where mine.user_id=(select auth.uid()) and mine.status='active' and mine.role='admin'
      and other.user_id=p_user and other.status='active')
  or exists(select 1 from public.qb_department_members mine
    join public.qb_department_members other on other.department_id=mine.department_id
    join public.qb_departments d on d.id=mine.department_id
    join public.qb_org_members om on om.org_id=d.org_id and om.user_id=mine.user_id and om.status='active'
    join public.qb_org_members ot on ot.org_id=d.org_id and ot.user_id=other.user_id and ot.status='active'
    where mine.user_id=(select auth.uid()) and other.user_id=p_user and mine.status='active' and other.status='active')
  or exists(select 1 from public.qb_projects p where qb_private.user_can_access_project(p.id,(select auth.uid()))
    and qb_private.user_can_access_project(p.id,p_user)));
$$;
alter policy qb_profile_read on public.qb_profiles using (qb_private.can_view_profile(user_id));

-- A target's relevant authorization rows are held until the write commits. If a
-- suspension commits first, checks below observe it; later suspension removes access
-- without erasing historical assignments. Missing paths fail closed.
create function qb_private.lock_project_user(p_project uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.qb_projects%rowtype;
begin
 select * into p from public.qb_projects where id=p_project for share;
 if not found then raise exception using errcode='42501',message='Target is not eligible for this scope'; end if;
 perform 1 from public.qb_org_members where org_id=p.org_id and user_id=p_user for share;
 perform 1 from public.qb_department_members where department_id=p.department_id and user_id=p_user for share;
 perform 1 from public.qb_project_members where project_id=p_project and user_id=p_user for share;
end;
$$;

create function qb_private.guard_task_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 -- Revalidate only changed references. Unrelated edits may preserve historical
 -- assignments after someone loses access; this does not restore their permissions.
 for target in select distinct u from unnest(array[
   case when tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id or new.project_id is distinct from old.project_id or new.visibility is distinct from old.visibility then new.assignee_id end,
   case when tg_op='INSERT' or new.reviewer_id is distinct from old.reviewer_id or new.project_id is distinct from old.project_id or new.visibility is distinct from old.visibility then new.reviewer_id end
 ]) as targets(u) where u is not null order by u loop
  perform qb_private.lock_project_user(new.project_id,target);
  if not qb_private.user_can_access_project(new.project_id,target) then
   raise exception using errcode='42501',message='Target is not eligible for this scope';
  end if;
  if new.visibility='restricted' then
   perform 1 from public.qb_task_participants where task_id=new.id and user_id=target for share;
   if not found then raise exception using errcode='42501',message='Target is not eligible for this scope'; end if;
  end if;
 end loop;
 return new;
end;
$$;
create trigger qb_task_assignment_guard before insert or update on public.qb_tasks
for each row execute function qb_private.guard_task_assignment();

-- Management without content visibility must not bootstrap access to a restricted project.
alter policy qb_tasks_insert on public.qb_tasks with check (
 qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id)
 and created_by=(select auth.uid()) and status='backlog' and completed_at is null);
alter policy qb_pm_insert on public.qb_project_members with check (
 qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id) and role in ('contributor','viewer'));
alter policy qb_pm_update on public.qb_project_members using (
 qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id)) with check (
 qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id) and role in ('contributor','viewer'));

-- Membership creates access, so require active membership of the destination org,
-- not prior access to the project. Existing RLS still controls WHO may grant roles.
create function qb_private.guard_scoped_member() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_org uuid;
begin
 if tg_op='UPDATE' then
  if new.user_id<>old.user_id
    or (tg_table_name='qb_department_members' and to_jsonb(new)->>'department_id'<>to_jsonb(old)->>'department_id')
    or (tg_table_name='qb_project_members' and to_jsonb(new)->>'project_id'<>to_jsonb(old)->>'project_id') then
   raise exception using errcode='23514',message='Membership identity cannot change';
  end if;
 end if;
 -- Suspension of stale membership must always remain possible.
 if new.status='suspended' then return new; end if;
 if tg_table_name='qb_department_members' then
  select org_id into target_org from public.qb_departments where id=new.department_id;
 else
  select org_id into target_org from public.qb_projects where id=new.project_id;
 end if;
 perform 1 from public.qb_org_members where org_id=target_org and user_id=new.user_id and status='active' for share;
 if not found then raise exception using errcode='42501',message='Target is not eligible for this scope'; end if;
 return new;
end;
$$;
create trigger qb_department_member_guard before insert or update on public.qb_department_members
for each row execute function qb_private.guard_scoped_member();
create trigger qb_project_member_guard before insert or update on public.qb_project_members
for each row execute function qb_private.guard_scoped_member();
revoke update on public.qb_department_members,public.qb_project_members from authenticated;
grant update(role,status) on public.qb_department_members,public.qb_project_members to authenticated;

create function qb_private.guard_task_participant() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_project uuid;
begin
 if tg_op='UPDATE' and (new.task_id<>old.task_id or new.user_id<>old.user_id) then
  raise exception using errcode='23514',message='Participant identity cannot change';
 end if;
 select project_id into target_project from public.qb_tasks where id=new.task_id;
 perform qb_private.lock_project_user(target_project,new.user_id);
 if not qb_private.user_can_access_project(target_project,new.user_id) then
  raise exception using errcode='42501',message='Target is not eligible for this scope';
 end if;
 return new;
end;
$$;
create trigger qb_task_participant_guard before insert or update on public.qb_task_participants
for each row execute function qb_private.guard_task_participant();
revoke update on public.qb_task_participants from authenticated;
alter policy qb_tp_read on public.qb_task_participants using (qb_private.can_view_task(task_id));

-- Return only names/IDs for assignment controls; no org roster, email or role data.
-- A manager must also have content visibility; management alone is not a bypass.
create function public.qb_assignment_candidates(p_project uuid,p_task uuid default null)
returns table(user_id uuid,display_name text)
language plpgsql stable security definer set search_path='' as $$
declare t public.qb_tasks%rowtype;
begin
 if (select auth.uid()) is null or not qb_private.can_view_project(p_project) or not qb_private.can_manage_project(p_project) then
  raise exception using errcode='42501',message='Project unavailable';
 end if;
 if p_task is not null then
  select * into t from public.qb_tasks where id=p_task;
  if not found or t.project_id<>p_project or not qb_private.can_view_task(p_task) then
   raise exception using errcode='42501',message='Task unavailable';
  end if;
 end if;
 return query select m.user_id,coalesce(nullif(pr.display_name,''),'Team member')
 from public.qb_org_members m join public.qb_projects p on p.org_id=m.org_id and p.id=p_project
 left join public.qb_profiles pr on pr.user_id=m.user_id
 where m.status='active' and qb_private.user_can_access_project(p_project,m.user_id)
 and (p_task is null or t.visibility='inherit' or exists(select 1 from public.qb_task_participants tp where tp.task_id=p_task and tp.user_id=m.user_id))
 order by coalesce(nullif(pr.display_name,''),'Team member'),m.user_id;
end;
$$;

revoke all on function qb_private.user_can_access_project(uuid,uuid),qb_private.can_view_profile(uuid),
 qb_private.lock_project_user(uuid,uuid),qb_private.guard_task_assignment(),qb_private.guard_scoped_member(),
 qb_private.guard_task_participant() from public,anon,authenticated;
grant execute on function qb_private.can_view_profile(uuid) to authenticated;
revoke all on function public.qb_assignment_candidates(uuid,uuid) from public,anon;
grant execute on function public.qb_assignment_candidates(uuid,uuid) to authenticated;
commit;
