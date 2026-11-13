begin;
set local lock_timeout='5s';
-- Owners retain the admin role for compatibility with existing authorization policies.
alter table public.qb_org_members add column is_owner boolean not null default false;
alter table public.qb_org_members add constraint qb_owner_active_admin check(not is_owner or (role='admin' and status='active'));
-- Existing active administrators retain their full authority as owners.
update public.qb_org_members set is_owner=true where role='admin' and status='active';
create function qb_private.is_org_owner(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.qb_org_members where org_id=p_org and user_id=(select auth.uid()) and is_owner and status='active');
$$;
revoke all on function qb_private.is_org_owner(uuid) from public,anon,authenticated;

create function qb_private.guard_org_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.is_owner and (not new.is_owner or new.role<>'admin' or new.status<>'active') then
  if not exists(select 1 from public.qb_org_members where org_id=old.org_id and user_id<>old.user_id and is_owner and status='active') then
   raise exception 'Promote another active organization owner first' using errcode='23514';
  end if;
 elsif tg_op='DELETE' and old.is_owner then
  if not exists(select 1 from public.qb_org_members where org_id=old.org_id and user_id<>old.user_id and is_owner and status='active') then
   raise exception 'Promote another active organization owner first' using errcode='23514';
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger qb_01_org_owner before update or delete on public.qb_org_members for each row execute function qb_private.guard_org_owner();
revoke all on function qb_private.guard_org_owner() from public,anon,authenticated;

-- Keep the existing role matrix and leadership guards as a private implementation.
alter function public.qb_manage_membership(text,uuid,uuid,text,text,text,text) set schema qb_private;
alter function qb_private.qb_manage_membership(text,uuid,uuid,text,text,text,text) rename to manage_membership_legacy;
revoke all on function qb_private.manage_membership_legacy(text,uuid,uuid,text,text,text,text) from public,anon,authenticated;

create function public.qb_manage_membership(p_type text,p_scope uuid,p_user uuid,p_action text,p_role text,
 p_expected_role text default null,p_expected_status text default null) returns void
language plpgsql security definer set search_path='' as $$
declare o uuid; r record; actual_owner boolean:=false; actor_owner boolean; old_role text; old_status text; target_email text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 if p_type='organization' then o:=p_scope;
 elsif p_type='department' then select org_id into o from public.qb_departments where id=p_scope;
 elsif p_type='project' then select org_id into o from public.qb_projects where id=p_scope;
 else raise exception 'Invalid scope' using errcode='22023';end if;
 perform 1 from public.qb_organizations where id=o for no key update;
 if not found or not qb_private.can_administer_members(p_type,p_scope) then raise exception 'Scope unavailable' using errcode='42501';end if;
 actor_owner:=qb_private.is_org_owner(o);
 if p_type='organization' then
  select role,status,is_owner into old_role,old_status,actual_owner from public.qb_org_members where org_id=o and user_id=p_user for update;
  if (case when actual_owner then 'owner' else old_role end) is distinct from p_expected_role or old_status is distinct from p_expected_status then raise exception 'Membership changed; reload before saving' using errcode='40001';end if;
  if (actual_owner or (p_action='role' and p_role='owner')) and not actor_owner then raise exception 'Only an organization owner can change ownership or another owner' using errcode='42501';end if;
  if p_action='role' and p_role='owner' then
   if old_status is distinct from 'active' then raise exception 'Reinstate the member before making them an owner' using errcode='22023';end if;
   update public.qb_org_members set role='admin',is_owner=true where org_id=o and user_id=p_user;return;
  end if;
  if actual_owner and p_action in ('role','remove') then
   update public.qb_org_members set is_owner=false where org_id=o and user_id=p_user;
  elsif actual_owner and p_action='suspend' then raise exception 'Change the owner to administrator or member before suspending them' using errcode='23514';end if;
 end if;
 if p_action<>'remove' then
  perform qb_private.manage_membership_legacy(p_type,p_scope,p_user,p_action,p_role,case when p_expected_role='owner' then 'admin' else p_expected_role end,p_expected_status);return;
 end if;
 if p_type='organization' then
  -- Release outstanding reservations before membership disappears; earned balances remain.
  perform qb_private.reward_lock(o);
  for r in select id from public.qb_reward_redemptions where org_id=o and user_id=p_user and status in ('requested','approved') order by id loop
   perform qb_private.reward_release(r.id,'canceled','Organization membership removed');
  end loop;
 end if;
 -- Suspension runs the existing authorization, optimistic-state, invitation and
 -- last-manager checks. Deletion then clears access rows without deleting history.
 if p_expected_status='active' then
  perform qb_private.manage_membership_legacy(p_type,p_scope,p_user,'suspend',null,case when p_expected_role='owner' then 'admin' else p_expected_role end,p_expected_status);
 elsif p_expected_status='suspended' then
  -- A no-op role action validates authorization and expected state for suspended rows.
  perform qb_private.manage_membership_legacy(p_type,p_scope,p_user,'role',p_expected_role,p_expected_role,p_expected_status);
 else raise exception 'Reload members before removing them' using errcode='40001';end if;
 select email into target_email from auth.users where id=p_user;
 update public.qb_invitations set status='revoked' where org_id=o and status='pending' and lower(invited_email)=lower(target_email)
 and (p_type='organization' or (scope_type=p_type and scope_id=p_scope) or (p_type='department' and scope_type='project' and scope_id in(select id from public.qb_projects where department_id=p_scope)));
 if p_type in ('organization','department') then
  update public.qb_project_members pm set status='suspended' from public.qb_projects p where pm.project_id=p.id and pm.user_id=p_user and p.org_id=o and (p_type='organization' or p.department_id=p_scope) and pm.status='active';
  delete from public.qb_project_members pm using public.qb_projects p where pm.project_id=p.id and pm.user_id=p_user and p.org_id=o and (p_type='organization' or p.department_id=p_scope);
 end if;
 delete from public.qb_task_participants tp using public.qb_tasks t,public.qb_projects p where tp.task_id=t.id and t.project_id=p.id and tp.user_id=p_user and p.org_id=o and (p_type='organization' or (p_type='department' and p.department_id=p_scope) or (p_type='project' and p.id=p_scope));
 if p_type='organization' then
  update public.qb_department_members dm set status='suspended' from public.qb_departments d where dm.department_id=d.id and dm.user_id=p_user and d.org_id=o and dm.status='active';
  delete from public.qb_department_members dm using public.qb_departments d where dm.department_id=d.id and dm.user_id=p_user and d.org_id=o;
  delete from public.qb_org_members where org_id=o and user_id=p_user;
 elsif p_type='department' then delete from public.qb_department_members where department_id=p_scope and user_id=p_user;
 else delete from public.qb_project_members where project_id=p_scope and user_id=p_user;end if;
end $$;
revoke all on function public.qb_manage_membership(text,uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.qb_manage_membership(text,uuid,uuid,text,text,text,text) to authenticated;
create or replace function qb_private.audit_membership_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; r jsonb; typ text; scope uuid; o uuid; u uuid; reducing boolean;
begin
 if tg_op<>'INSERT' then b:=jsonb_build_object('role',old.role,'status',old.status); end if;
 if tg_op<>'DELETE' then a:=jsonb_build_object('role',new.role,'status',new.status); end if;
 if tg_table_name='qb_org_members' then
  if b is not null then b:=b||jsonb_build_object('is_owner',to_jsonb(old)->'is_owner');end if;
  if a is not null then a:=a||jsonb_build_object('is_owner',to_jsonb(new)->'is_owner');end if;
 end if;
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
create or replace function public.qb_membership_directory(p_type text,p_scope uuid)
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
  select case when x.is_owner then 'owner' else x.role end,x.status from public.qb_org_members x where p_type='organization' and x.org_id=p_scope and x.user_id=om.user_id
  union all select x.role,x.status from public.qb_department_members x where p_type='department' and x.department_id=p_scope and x.user_id=om.user_id
  union all select x.role,x.status from public.qb_project_members x where p_type='project' and x.project_id=p_scope and x.user_id=om.user_id
 ) m on true
 where om.org_id=o and (m.role is not null or (om.status='active' and qb_private.can_view_profile(om.user_id)))
 order by coalesce(nullif(pr.display_name,''),'Team member'),om.user_id;
end;
$$;
create or replace function qb_private.create_organization(p_name text,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); organization uuid; clean_name text:=btrim(p_name);
begin
 if caller is null or not exists(select 1 from auth.users where id=caller and email is not null and email_confirmed_at is not null) then
  raise exception 'Sign in with a verified email before creating an organization' using errcode='42501';
 end if;
 if p_request is null or clean_name is null or char_length(clean_name)<2 or char_length(clean_name)>120 then
  raise exception 'Enter an organization name between 2 and 120 characters' using errcode='22023';
 end if;
 -- Serializes retries for this identity without locking unrelated users.
 perform pg_advisory_xact_lock(hashtextextended('qb-create-org:'||caller::text,0));
 select org_id into organization from qb_private.organization_creation_requests where user_id=caller and request_id=p_request;
 if found then
  if not qb_private.is_org_admin(organization) then
   raise exception 'Organization access changed' using errcode='42501';
  end if;
  return organization;
 end if;
 insert into public.qb_organizations(name) values(clean_name) returning id into organization;
 insert into public.qb_org_members(org_id,user_id,role,status,is_owner) values(organization,caller,'admin','active',true);
 insert into qb_private.organization_creation_requests(user_id,request_id,org_id) values(caller,p_request,organization);
 return organization;
end;
$$;

commit;
