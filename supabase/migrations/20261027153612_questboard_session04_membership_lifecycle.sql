-- Additive after Sessions 2 and 3. No data backfill; no MeetingDesk/Auth changes.
begin;
set local lock_timeout='5s';
create table public.qb_membership_events (
 id uuid primary key default gen_random_uuid(), org_id uuid not null,
 scope_type text not null check(scope_type in ('organization','department','project')),
 scope_id uuid not null, user_id uuid not null, actor_id uuid,
 before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index qb_membership_events_scope on public.qb_membership_events(org_id,scope_type,scope_id,created_at desc);
alter table public.qb_membership_events enable row level security;
revoke all on public.qb_membership_events from public,anon,authenticated;
grant select on public.qb_membership_events to authenticated;

create function qb_private.can_administer_members(p_type text,p_scope uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and case p_type
 when 'organization' then qb_private.is_org_admin(p_scope)
 when 'department' then qb_private.is_department_manager(p_scope)
 when 'project' then qb_private.can_manage_project(p_scope) and qb_private.can_view_project(p_scope)
 else false end;
$$;
create policy qb_membership_event_read on public.qb_membership_events for select to authenticated
 using(qb_private.can_administer_members(scope_type,scope_id));

-- Serialize all membership writes in one organization. No advisory-lock hash collisions.
-- Direct privileged writes can deadlock with existing invitation row locks: PostgreSQL
-- aborts one transaction safely; retry the whole transaction, never bypass the guard.
create function qb_private.lock_membership_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb; o uuid;
begin
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_op='UPDATE' and (new.user_id<>old.user_id or
   (tg_table_name='qb_org_members' and r->>'org_id'<>to_jsonb(old)->>'org_id')) then
  raise exception using errcode='23514',message='Membership identity cannot change';
 end if;
 if tg_table_name='qb_org_members' then o:=(r->>'org_id')::uuid;
 elsif tg_table_name='qb_department_members' then select org_id into o from public.qb_departments where id=(r->>'department_id')::uuid;
 else select org_id into o from public.qb_projects where id=(r->>'project_id')::uuid; end if;
 perform 1 from public.qb_organizations where id=o for update;
 return case when tg_op='DELETE' then old else new end;
end;
$$;

create function qb_private.audit_membership_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; r jsonb; typ text; scope uuid; o uuid; u uuid; reducing boolean;
begin
 if tg_op<>'INSERT' then b:=jsonb_build_object('role',old.role,'status',old.status); end if;
 if tg_op<>'DELETE' then a:=jsonb_build_object('role',new.role,'status',new.status); end if;
 if a is not distinct from b then return null; end if;
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;u:=(r->>'user_id')::uuid;
 if tg_table_name='qb_org_members' then typ:='organization';scope:=(r->>'org_id')::uuid;o:=scope;
 elsif tg_table_name='qb_department_members' then typ:='department';scope:=(r->>'department_id')::uuid;select org_id into o from public.qb_departments where id=scope;
 else typ:='project';scope:=(r->>'project_id')::uuid;select org_id into o from public.qb_projects where id=scope;end if;
 reducing:=b->>'status'='active' and (a is null or a->>'status'<>'active' or a->>'role'<>b->>'role');
 if reducing then
  if typ='organization' and b->>'role'='admin' and not exists(select 1 from public.qb_org_members where org_id=o and role='admin' and status='active') then
   raise exception using errcode='23514',message='Keep at least one active organization administrator';
  end if;
  if ((typ='department' and b->>'role'='manager') or (typ='organization' and (a is null or a->>'status'<>'active'))) and exists(
   select 1 from public.qb_departments d where d.org_id=o
   and ((typ='department' and d.id=scope) or (typ='organization' and exists(select 1 from public.qb_department_members dm where dm.department_id=d.id and dm.user_id=u and dm.role='manager' and dm.status='active')))
   and not exists(select 1 from public.qb_department_members dm join public.qb_org_members om on om.org_id=o and om.user_id=dm.user_id and om.status='active'
    where dm.department_id=d.id and dm.role='manager' and dm.status='active')) then
   raise exception using errcode='23514',message='Keep at least one active department manager';
  end if;
  if exists(select 1 from public.qb_projects p where p.org_id=o
   and ((typ='project' and p.id=scope and (b->>'role'='lead' or exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=u and dm.role='manager' and dm.status='active')))
    or (typ='department' and p.department_id=scope and b->>'role'='manager')
    or (typ='organization' and (a is null or a->>'status'<>'active') and (
     exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=u and pm.role='lead' and pm.status='active')
     or exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=u and dm.role='manager' and dm.status='active'))))
   and not exists(select 1 from public.qb_org_members om where om.org_id=o and om.status='active'
     and qb_private.user_can_access_project(p.id,om.user_id) and (
      exists(select 1 from public.qb_project_members pm where pm.project_id=p.id and pm.user_id=om.user_id and pm.role='lead' and pm.status='active')
      or exists(select 1 from public.qb_department_members dm where dm.department_id=p.department_id and dm.user_id=om.user_id and dm.role='manager' and dm.status='active')))) then
   raise exception using errcode='23514',message='Keep at least one manager with project access';
  end if;
 end if;
 insert into public.qb_membership_events(org_id,scope_type,scope_id,user_id,actor_id,before_data,after_data)
 values(o,typ,scope,u,(select auth.uid()),b,a);
 return null;
end;
$$;
create trigger qb_00_org_lifecycle before insert or update or delete on public.qb_org_members for each row execute function qb_private.lock_membership_scope();
create trigger qb_00_dept_lifecycle before insert or update or delete on public.qb_department_members for each row execute function qb_private.lock_membership_scope();
create trigger qb_00_project_lifecycle before insert or update or delete on public.qb_project_members for each row execute function qb_private.lock_membership_scope();
create trigger qb_org_lifecycle_audit after insert or update or delete on public.qb_org_members for each row execute function qb_private.audit_membership_change();
create trigger qb_dept_lifecycle_audit after insert or update or delete on public.qb_department_members for each row execute function qb_private.audit_membership_change();
create trigger qb_project_lifecycle_audit after insert or update or delete on public.qb_project_members for each row execute function qb_private.audit_membership_change();

-- Explicit action + expected role/status provides optimistic concurrency. A stale UI
-- cannot silently reinstate or demote someone changed by a different administrator.
create function public.qb_manage_membership(p_type text,p_scope uuid,p_user uuid,p_action text,p_role text,
 p_expected_role text default null,p_expected_status text default null) returns void
language plpgsql security definer set search_path='' as $$
declare o uuid; tbl text; col text; old_role text; old_status text; next_role text; next_status text;
begin
 if (select auth.uid()) is null then raise exception using errcode='42501',message='Sign in required';end if;
 if p_type='organization' then o:=p_scope;tbl:='qb_org_members';col:='org_id';
 elsif p_type='department' then select org_id into o from public.qb_departments where id=p_scope;tbl:='qb_department_members';col:='department_id';
 elsif p_type='project' then select org_id into o from public.qb_projects where id=p_scope;tbl:='qb_project_members';col:='project_id';
 else raise exception using errcode='22023',message='Invalid scope';end if;
 perform 1 from public.qb_organizations where id=o for update;
 if not found or not qb_private.can_administer_members(p_type,p_scope) then raise exception using errcode='42501',message='Scope unavailable';end if;
 execute format('select role,status from public.%I where %I=$1 and user_id=$2 for update',tbl,col) into old_role,old_status using p_scope,p_user;
 if old_role is distinct from p_expected_role or old_status is distinct from p_expected_status then
  raise exception using errcode='40001',message='Membership changed; reload before saving';end if;
 if p_action='grant' and old_role is null and p_type<>'organization' then next_role:=p_role;next_status:='active';
 elsif p_action='role' and old_role is not null then next_role:=p_role;next_status:=old_status;
 elsif p_action='suspend' and old_status='active' then next_role:=old_role;next_status:='suspended';
 elsif p_action='reinstate' and old_status='suspended' then next_role:=old_role;next_status:='active';
 else raise exception using errcode='22023',message='Invalid membership action; new organization members must accept an invitation';end if;
 if next_role is null or not (case p_type when 'organization' then next_role in ('admin','member') when 'department' then next_role in ('manager','contributor','viewer') else next_role in ('lead','contributor','viewer') end) then
  raise exception using errcode='22023',message='Invalid role';end if;
 -- Existing authority: org admins control department leadership; ordinary managers
 -- cannot alter manager/lead rows or grant elevated roles. Project leadership also requires org administration.
 if p_type='department' and not qb_private.is_org_admin(o) and (next_role='manager' or old_role='manager') then
  raise exception using errcode='42501',message='Department leadership requires organization administration';end if;
 if p_type='project' and not qb_private.is_org_admin(o) and (next_role='lead' or old_role='lead') then
  raise exception using errcode='42501',message='Project leadership requires organization administration and project management';end if;
 if old_role is null then
  execute format('insert into public.%I(%I,user_id,role,status) values($1,$2,$3,$4)',tbl,col) using p_scope,p_user,next_role,next_status;
 else
  execute format('update public.%I set role=$3,status=$4 where %I=$1 and user_id=$2',tbl,col) using p_scope,p_user,next_role,next_status;
 end if;
end;
$$;

-- Scoped administration directory. Current memberships include suspended people for
-- reinstatement. Grant choices expose only already-visible profiles or org-admin roster.
create function public.qb_membership_directory(p_type text,p_scope uuid)
returns table(user_id uuid,display_name text,role text,status text,org_status text)
language plpgsql stable security definer set search_path='' as $$
declare o uuid;
begin
 if not qb_private.can_administer_members(p_type,p_scope) then raise exception using errcode='42501',message='Scope unavailable';end if;
 if p_type='organization' then o:=p_scope;
 elsif p_type='department' then select org_id into o from public.qb_departments where id=p_scope;
 else select org_id into o from public.qb_projects where id=p_scope;end if;
 return query select om.user_id,coalesce(nullif(pr.display_name,''),'Team member'),m.role,m.status,om.status
 from public.qb_org_members om left join public.qb_profiles pr on pr.user_id=om.user_id
 left join lateral (
  select x.role,x.status from public.qb_org_members x where p_type='organization' and x.org_id=p_scope and x.user_id=om.user_id
  union all select x.role,x.status from public.qb_department_members x where p_type='department' and x.department_id=p_scope and x.user_id=om.user_id
  union all select x.role,x.status from public.qb_project_members x where p_type='project' and x.project_id=p_scope and x.user_id=om.user_id
 ) m on true
 where om.org_id=o and (m.role is not null or (om.status='active' and qb_private.can_view_profile(om.user_id)))
 order by coalesce(nullif(pr.display_name,''),'Team member'),om.user_id;
end;
$$;
revoke all on function qb_private.can_administer_members(text,uuid),qb_private.lock_membership_scope(),qb_private.audit_membership_change() from public,anon,authenticated;
grant execute on function qb_private.can_administer_members(text,uuid) to authenticated;
revoke all on function public.qb_manage_membership(text,uuid,uuid,text,text,text,text),public.qb_membership_directory(text,uuid) from public,anon;
grant execute on function public.qb_manage_membership(text,uuid,uuid,text,text,text,text),public.qb_membership_directory(text,uuid) to authenticated;
commit;
