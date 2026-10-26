-- QuestBoard v0.1 schema. Additive to MeetingDesk; does not alter meeting_workspaces.
create schema if not exists qb_private;
revoke all on schema qb_private from public, anon;
grant usage on schema qb_private to authenticated;

create table public.qb_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table public.qb_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  preferred_mode text not null default 'professional' check (preferred_mode in ('professional','rpg')),
  created_at timestamptz not null default now()
);
create table public.qb_org_members (
  org_id uuid not null references public.qb_organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('admin','member')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  primary key (org_id,user_id)
);
create table public.qb_departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.qb_organizations(id),
  name text not null,
  color text not null default '#658be7',
  created_at timestamptz not null default now(),
  unique (org_id,name)
);
create table public.qb_department_members (
  department_id uuid not null references public.qb_departments(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('manager','contributor','viewer')),
  status text not null default 'active' check (status in ('active','suspended')),
  primary key (department_id,user_id)
);
create table public.qb_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.qb_organizations(id),
  department_id uuid not null references public.qb_departments(id),
  title text not null,
  summary text not null default '',
  status text not null default 'active' check (status in ('planned','active','paused','complete','archived')),
  visibility text not null default 'department' check (visibility in ('department','invited','restricted')),
  lead_id uuid references auth.users(id),
  target_date date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.qb_project_members (
  project_id uuid not null references public.qb_projects(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('lead','contributor','viewer')),
  status text not null default 'active' check (status in ('active','suspended')),
  primary key (project_id,user_id)
);
create table public.qb_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.qb_projects(id),
  title text not null,
  description text not null default '',
  status text not null default 'backlog' check (status in ('backlog','ready','in_progress','blocked','in_review','complete','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  visibility text not null default 'inherit' check (visibility in ('inherit','restricted')),
  assignee_id uuid references auth.users(id),
  reviewer_id uuid references auth.users(id),
  due_date date,
  xp_reward int not null default 25 check (xp_reward between 0 and 500),
  created_by uuid not null references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.qb_task_participants (
  task_id uuid not null references public.qb_tasks(id),
  user_id uuid not null references auth.users(id),
  primary key (task_id,user_id)
);
create table public.qb_checklist (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.qb_tasks(id),
  title text not null,
  done boolean not null default false,
  position int not null default 0
);
create table public.qb_task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.qb_tasks(id),
  author_id uuid not null references auth.users(id),
  kind text not null default 'note' check (kind in ('note','action','blocker','resolution','next_step')),
  body text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now()
);
create table public.qb_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.qb_tasks(id),
  actor_id uuid references auth.users(id),
  event_type text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create table public.qb_xp_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.qb_tasks(id),
  user_id uuid not null references auth.users(id),
  amount int not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create table public.qb_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.qb_organizations(id),
  invited_email text not null,
  scope_type text not null check (scope_type in ('organization','department','project')),
  scope_id uuid,
  invite_role text not null check (invite_role in ('member','department_manager','department_contributor','department_viewer','project_lead','project_contributor','project_viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  check (char_length(invited_email) <= 320)
);

create index on public.qb_org_members(user_id);
create index on public.qb_department_members(user_id);
create index on public.qb_project_members(user_id);
create index on public.qb_tasks(project_id,status);
create index on public.qb_tasks(assignee_id,status);
create index on public.qb_task_updates(task_id,created_at desc);
create index on public.qb_invitations(lower(invited_email));

create function qb_private.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.qb_org_members m where m.org_id=p_org and m.user_id=(select auth.uid()) and m.status='active');
$$;
create function qb_private.is_org_admin(p_org uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.qb_org_members m where m.org_id=p_org and m.user_id=(select auth.uid()) and m.role='admin' and m.status='active');
$$;
create function qb_private.is_department_member(p_dept uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.qb_department_members m join public.qb_departments d on d.id=m.department_id join public.qb_org_members om on om.org_id=d.org_id and om.user_id=m.user_id and om.status='active' where m.department_id=p_dept and m.user_id=(select auth.uid()) and m.status='active');
$$;
create function qb_private.is_department_manager(p_dept uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.qb_departments d where d.id=p_dept and (
    exists(select 1 from public.qb_org_members om where om.org_id=d.org_id and om.user_id=(select auth.uid()) and om.role='admin' and om.status='active')
    or exists(select 1 from public.qb_department_members m where m.department_id=p_dept and m.user_id=(select auth.uid()) and m.role='manager' and m.status='active')
  ));
$$;
create function qb_private.can_view_project(p_project uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.qb_projects p where p.id=p_project and
    exists(select 1 from public.qb_org_members om where om.org_id=p.org_id and om.user_id=(select auth.uid()) and om.status='active') and
    (exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=(select auth.uid()) and pm.status='active')
      or (p.visibility='department' and exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=(select auth.uid()) and dm.status='active')))
  );
$$;
create function qb_private.can_manage_project(p_project uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.qb_projects p where p.id=p_project and
    exists(select 1 from public.qb_org_members om where om.org_id=p.org_id and om.user_id=(select auth.uid()) and om.status='active') and
    (exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=(select auth.uid()) and dm.role='manager' and dm.status='active')
      or exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=(select auth.uid()) and pm.role='lead' and pm.status='active'))
  );
$$;
create function qb_private.can_view_task(p_task uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.qb_tasks t where t.id=p_task and qb_private.can_view_project(t.project_id) and
    (t.visibility='inherit' or exists(select 1 from public.qb_task_participants tp where tp.task_id=t.id and tp.user_id=(select auth.uid())))
  );
$$;

revoke all on all functions in schema qb_private from public, anon;
grant execute on all functions in schema qb_private to authenticated;

alter table public.qb_organizations enable row level security;
alter table public.qb_profiles enable row level security;
alter table public.qb_org_members enable row level security;
alter table public.qb_departments enable row level security;
alter table public.qb_department_members enable row level security;
alter table public.qb_projects enable row level security;
alter table public.qb_project_members enable row level security;
alter table public.qb_tasks enable row level security;
alter table public.qb_task_participants enable row level security;
alter table public.qb_checklist enable row level security;
alter table public.qb_task_updates enable row level security;
alter table public.qb_task_events enable row level security;
alter table public.qb_xp_events enable row level security;
alter table public.qb_invitations enable row level security;

revoke all on public.qb_organizations, public.qb_profiles, public.qb_org_members, public.qb_departments, public.qb_department_members, public.qb_projects, public.qb_project_members, public.qb_tasks, public.qb_task_participants, public.qb_checklist, public.qb_task_updates, public.qb_task_events, public.qb_xp_events, public.qb_invitations from public, anon, authenticated;
grant select on public.qb_organizations, public.qb_org_members, public.qb_departments, public.qb_department_members, public.qb_projects, public.qb_project_members, public.qb_tasks, public.qb_task_participants, public.qb_checklist, public.qb_task_updates, public.qb_task_events, public.qb_xp_events, public.qb_invitations to authenticated;
grant select,insert,update on public.qb_profiles to authenticated;
grant insert,update on public.qb_departments, public.qb_department_members, public.qb_project_members, public.qb_checklist, public.qb_invitations to authenticated;
grant insert on public.qb_projects, public.qb_tasks to authenticated;
grant update(title,summary,status,lead_id,target_date,updated_at) on public.qb_projects to authenticated;
grant update(title,description,priority,assignee_id,reviewer_id,due_date,xp_reward,updated_at) on public.qb_tasks to authenticated;
grant insert,update on public.qb_task_participants to authenticated;
grant insert on public.qb_task_updates to authenticated;

create policy qb_org_read on public.qb_organizations for select to authenticated using (qb_private.is_org_member(id));
create policy qb_profile_read on public.qb_profiles for select to authenticated using (user_id=(select auth.uid()) or exists(select 1 from public.qb_org_members m where m.user_id=qb_profiles.user_id and qb_private.is_org_member(m.org_id)));
create policy qb_profile_insert on public.qb_profiles for insert to authenticated with check (user_id=(select auth.uid()));
create policy qb_profile_update on public.qb_profiles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy qb_members_read on public.qb_org_members for select to authenticated using (user_id=(select auth.uid()) or qb_private.is_org_admin(org_id));
create policy qb_dept_read on public.qb_departments for select to authenticated using (qb_private.is_org_member(org_id));
create policy qb_dept_insert on public.qb_departments for insert to authenticated with check (qb_private.is_org_admin(org_id));
create policy qb_dept_update on public.qb_departments for update to authenticated using (qb_private.is_org_admin(org_id)) with check (qb_private.is_org_admin(org_id));
create policy qb_dept_members_read on public.qb_department_members for select to authenticated using (user_id=(select auth.uid()) or qb_private.is_department_manager(department_id));
create policy qb_dept_members_insert on public.qb_department_members for insert to authenticated with check (qb_private.is_department_manager(department_id) and role in ('contributor','viewer'));
create policy qb_dept_members_update on public.qb_department_members for update to authenticated using (qb_private.is_department_manager(department_id)) with check (qb_private.is_department_manager(department_id) and role in ('contributor','viewer'));
create policy qb_project_read on public.qb_projects for select to authenticated using (qb_private.can_view_project(id));
create policy qb_project_insert on public.qb_projects for insert to authenticated with check (qb_private.is_department_manager(department_id) and created_by=(select auth.uid()) and exists(select 1 from public.qb_departments d where d.id=department_id and d.org_id=org_id));
create policy qb_project_update on public.qb_projects for update to authenticated using (qb_private.can_manage_project(id)) with check (qb_private.can_manage_project(id));
create policy qb_pm_read on public.qb_project_members for select to authenticated using (qb_private.can_view_project(project_id));
create policy qb_pm_insert on public.qb_project_members for insert to authenticated with check (qb_private.can_manage_project(project_id) and role in ('contributor','viewer'));
create policy qb_pm_update on public.qb_project_members for update to authenticated using (qb_private.can_manage_project(project_id)) with check (qb_private.can_manage_project(project_id) and role in ('contributor','viewer'));
create policy qb_tasks_read on public.qb_tasks for select to authenticated using (qb_private.can_view_task(id));
create policy qb_tasks_insert on public.qb_tasks for insert to authenticated with check (qb_private.can_manage_project(project_id) and created_by=(select auth.uid()));
create policy qb_tasks_update on public.qb_tasks for update to authenticated using (qb_private.can_manage_project(project_id) and qb_private.can_view_task(id)) with check (qb_private.can_manage_project(project_id) and qb_private.can_view_task(id));
create policy qb_tp_read on public.qb_task_participants for select to authenticated using (qb_private.can_view_task(task_id) or user_id=(select auth.uid()));
create policy qb_tp_insert on public.qb_task_participants for insert to authenticated with check (exists(select 1 from public.qb_tasks t where t.id=task_id and qb_private.can_manage_project(t.project_id) and qb_private.can_view_task(t.id)));
create policy qb_tp_update on public.qb_task_participants for update to authenticated using (exists(select 1 from public.qb_tasks t where t.id=task_id and qb_private.can_manage_project(t.project_id) and qb_private.can_view_task(t.id))) with check (exists(select 1 from public.qb_tasks t where t.id=task_id and qb_private.can_manage_project(t.project_id) and qb_private.can_view_task(t.id)));
create policy qb_check_read on public.qb_checklist for select to authenticated using (qb_private.can_view_task(task_id));
create policy qb_check_insert on public.qb_checklist for insert to authenticated with check (exists(select 1 from public.qb_tasks t where t.id=task_id and qb_private.can_manage_project(t.project_id)));
create policy qb_check_update on public.qb_checklist for update to authenticated using (exists(select 1 from public.qb_tasks t where t.id=task_id and qb_private.can_manage_project(t.project_id))) with check (exists(select 1 from public.qb_tasks t where t.id=task_id and qb_private.can_manage_project(t.project_id)));
create policy qb_updates_read on public.qb_task_updates for select to authenticated using (qb_private.can_view_task(task_id));
create policy qb_updates_insert on public.qb_task_updates for insert to authenticated with check (author_id=(select auth.uid()) and qb_private.can_view_task(task_id));
create policy qb_events_read on public.qb_task_events for select to authenticated using (qb_private.can_view_task(task_id));
create policy qb_xp_read on public.qb_xp_events for select to authenticated using (user_id=(select auth.uid()) or exists(select 1 from public.qb_tasks t where t.id=task_id and qb_private.can_manage_project(t.project_id)));
create policy qb_inv_read on public.qb_invitations for select to authenticated using (qb_private.is_org_admin(org_id));
create policy qb_inv_insert on public.qb_invitations for insert to authenticated with check (qb_private.is_org_admin(org_id) and created_by=(select auth.uid()) and status='pending' and (
  (scope_type='organization' and scope_id is null and invite_role='member') or
  (scope_type='department' and scope_id is not null and invite_role in ('department_manager','department_contributor','department_viewer') and exists(select 1 from public.qb_departments d where d.id=scope_id and d.org_id=org_id)) or
  (scope_type='project' and scope_id is not null and invite_role in ('project_lead','project_contributor','project_viewer') and exists(select 1 from public.qb_projects p where p.id=scope_id and p.org_id=org_id))
));
create policy qb_inv_update on public.qb_invitations for update to authenticated using (qb_private.is_org_admin(org_id)) with check (qb_private.is_org_admin(org_id));

-- Controlled task transitions: assigned staff may progress, reviewers may approve.
create function public.qb_transition_task(p_task uuid,p_new_status text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.qb_tasks%rowtype; manager_allowed boolean; actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Sign in required'; end if;
  select * into t from public.qb_tasks where id=p_task for update;
  if not found or not qb_private.can_view_task(p_task) then raise exception 'Task unavailable'; end if;
  manager_allowed := qb_private.can_manage_project(t.project_id);
  if not (manager_allowed or t.assignee_id=actor or t.reviewer_id=actor) then raise exception 'Not assigned to this task'; end if;
  if not (
    (t.status='backlog' and p_new_status='ready' and manager_allowed) or
    (t.status='ready' and p_new_status='in_progress' and (manager_allowed or t.assignee_id=actor)) or
    (t.status='in_progress' and p_new_status in ('blocked','in_review') and (manager_allowed or t.assignee_id=actor)) or
    (t.status='blocked' and p_new_status='in_progress' and (manager_allowed or t.assignee_id=actor)) or
    (t.status='in_review' and p_new_status='in_progress' and (manager_allowed or t.reviewer_id=actor)) or
    (t.status='in_review' and p_new_status='complete' and (manager_allowed or t.reviewer_id=actor) and actor<>coalesce(t.assignee_id,'00000000-0000-0000-0000-000000000000'::uuid)) or
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
create function public.qb_toggle_checklist(p_item uuid,p_done boolean) returns void language plpgsql security definer set search_path = '' as $$
declare t public.qb_tasks%rowtype; actor uuid := (select auth.uid());
begin
  select t.* into t from public.qb_tasks t join public.qb_checklist c on c.task_id=t.id where c.id=p_item;
  if not found or not qb_private.can_view_task(t.id) or not (t.assignee_id=actor or qb_private.can_manage_project(t.project_id)) then raise exception 'Not authorized'; end if;
  if t.status in ('complete','cancelled') then raise exception 'Task is closed'; end if;
  update public.qb_checklist set done=p_done where id=p_item;
  insert into public.qb_task_events(task_id,actor_id,event_type,after_data) values(t.id,actor,'checklist',jsonb_build_object('item_id',p_item,'done',p_done));
end;
$$;

-- Invitation acceptance by verified email; role scope is validated by the original insert policy.
create function public.qb_accept_invitation(p_invitation uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.qb_invitations%rowtype; actor uuid := (select auth.uid()); actor_email text; dept uuid;
begin
  if actor is null then raise exception 'Sign in required'; end if;
  select email into actor_email from auth.users where id=actor and email_confirmed_at is not null;
  if actor_email is null then raise exception 'A verified email is required'; end if;
  select * into i from public.qb_invitations where id=p_invitation for update;
  if not found or i.status<>'pending' or i.expires_at<=now() or lower(i.invited_email)<>lower(actor_email) then raise exception 'Invitation is invalid or expired'; end if;
  insert into public.qb_org_members(org_id,user_id,role,status) values(i.org_id,actor,'member','active')
    on conflict(org_id,user_id) do update set status='active';
  if i.scope_type='department' then
    insert into public.qb_department_members(department_id,user_id,role,status) values(i.scope_id,actor,replace(i.invite_role,'department_',''),'active')
      on conflict(department_id,user_id) do update set status='active';
  elsif i.scope_type='project' then
    select department_id into dept from public.qb_projects where id=i.scope_id;
    insert into public.qb_project_members(project_id,user_id,role,status) values(i.scope_id,actor,replace(i.invite_role,'project_',''),'active')
      on conflict(project_id,user_id) do update set status='active';
  end if;
  update public.qb_invitations set status='accepted',accepted_by=actor,accepted_at=now() where id=i.id;
  return i.org_id;
end;
$$;
create function public.qb_my_invitations() returns table(id uuid,org_name text,scope_type text,invite_role text,expires_at timestamptz) language sql stable security definer set search_path = '' as $$
  select i.id,o.name,i.scope_type,i.invite_role,i.expires_at from public.qb_invitations i join public.qb_organizations o on o.id=i.org_id
  join auth.users u on u.id=(select auth.uid()) and u.email_confirmed_at is not null and lower(u.email)=lower(i.invited_email)
  where i.status='pending' and i.expires_at>now();
$$;

revoke all on function public.qb_transition_task(uuid,text), public.qb_toggle_checklist(uuid,boolean), public.qb_accept_invitation(uuid), public.qb_my_invitations() from public, anon;
grant execute on function public.qb_transition_task(uuid,text), public.qb_toggle_checklist(uuid,boolean), public.qb_accept_invitation(uuid), public.qb_my_invitations() to authenticated;

-- Organization and initial administrator are provisioned separately.
-- This migration intentionally contains no university-specific account IDs,
-- personal email addresses, or production user records. See README.md.
