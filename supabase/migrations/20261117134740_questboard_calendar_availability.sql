-- Full-day organization holidays and staff absence ranges. No private leave reasons.
create table public.qb_calendar_availability (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.qb_organizations(id) on delete cascade,
 kind text not null check (kind in ('holiday','pto')),
 title text not null check (length(btrim(title)) between 1 and 120),
 user_id uuid references auth.users(id),
 start_date date not null,
 end_date date not null,
 non_working boolean not null default true,
 revision integer not null default 1,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 check (end_date>=start_date and end_date-start_date<=365),
 check (start_date>='1900-01-01'::date and end_date<='2200-12-31'::date),
 check ((kind='holiday' and user_id is null) or (kind='pto' and user_id is not null and non_working and title='PTO'))
);
create index qb_availability_org_dates on public.qb_calendar_availability(org_id,start_date,end_date);
create index qb_availability_user on public.qb_calendar_availability(user_id);
create index qb_availability_creator on public.qb_calendar_availability(created_by);
alter table public.qb_calendar_availability enable row level security;
revoke all on public.qb_calendar_availability from public,anon,authenticated;
grant select,insert,delete on public.qb_calendar_availability to authenticated;
grant update(title,user_id,start_date,end_date,non_working) on public.qb_calendar_availability to authenticated;
create policy qb_availability_read on public.qb_calendar_availability for select to authenticated
 using(qb_private.is_org_member(org_id));
create policy qb_availability_insert on public.qb_calendar_availability for insert to authenticated
 with check(qb_private.is_org_admin(org_id) and created_by=(select auth.uid()));
create policy qb_availability_update on public.qb_calendar_availability for update to authenticated
 using(qb_private.is_org_admin(org_id)) with check(qb_private.is_org_admin(org_id));
create policy qb_availability_delete on public.qb_calendar_availability for delete to authenticated
 using(qb_private.is_org_admin(org_id));
create function qb_private.guard_calendar_availability() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if new.kind='pto' and not exists(select 1 from public.qb_org_members m
   where m.org_id=new.org_id and m.user_id=new.user_id and m.status='active') then
   raise exception 'Choose an active member of this organization' using errcode='23514';
 end if;
 if tg_op='UPDATE' then
   if new.org_id<>old.org_id or new.kind<>old.kind or new.id<>old.id or new.created_by<>old.created_by then
     raise exception 'Availability scope is immutable' using errcode='42501';
   end if;
   new.revision:=old.revision+1;
 else new.revision:=1;
 end if;
 return new;
end $$;
create trigger qb_availability_guard before insert or update on public.qb_calendar_availability
 for each row execute function qb_private.guard_calendar_availability();
revoke all on function qb_private.guard_calendar_availability() from public,anon,authenticated;
