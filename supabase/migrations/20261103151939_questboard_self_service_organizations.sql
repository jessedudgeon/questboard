-- Self-service bootstrap is atomic and bound to the verified caller.
begin;
create table qb_private.organization_creation_requests (
 user_id uuid not null references auth.users(id),
 request_id uuid not null,
 org_id uuid not null references public.qb_organizations(id),
 primary key(user_id,request_id)
);
alter table qb_private.organization_creation_requests enable row level security;
revoke all on qb_private.organization_creation_requests from public,anon,authenticated;

-- Bootstrap requires narrowly scoped elevation: the caller cannot insert organizations
-- or grant themselves memberships directly. Only this private function can do both.
create function qb_private.create_organization(p_name text,p_request uuid)
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
 insert into public.qb_org_members(org_id,user_id,role,status) values(organization,caller,'admin','active');
 insert into qb_private.organization_creation_requests(user_id,request_id,org_id) values(caller,p_request,organization);
 return organization;
end;
$$;
revoke all on function qb_private.create_organization(text,uuid) from public,anon;
grant execute on function qb_private.create_organization(text,uuid) to authenticated;
create function public.qb_create_organization(p_name text,p_request uuid)
returns uuid language sql security invoker set search_path='' as $$
 select qb_private.create_organization(p_name,p_request);
$$;
revoke all on function public.qb_create_organization(text,uuid) from public,anon;
grant execute on function public.qb_create_organization(text,uuid) to authenticated;
commit;
