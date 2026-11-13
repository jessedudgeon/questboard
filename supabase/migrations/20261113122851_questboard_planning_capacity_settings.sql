begin;
set local lock_timeout='5s';
-- Effort (hours) and schedule duration (calendar days) are deliberately separate.
alter table public.qb_tasks
 add column start_date date,
 add column estimated_hours numeric(8,2) check(estimated_hours between 0 and 100000),
 add column remaining_hours numeric(8,2) check(remaining_hours between 0 and 100000),
 add column schedule_mode text not null default 'fixed' check(schedule_mode in ('fixed','milestone','milestone_deadline','project')),
 add column schedule_offset integer not null default 0 check(schedule_offset between -3650 and 3650),
 add column duration_days integer not null default 1 check(duration_days between 1 and 3650),
 add column assignee_invitation_id uuid references public.qb_invitations(id),
 add column planned_assignee_label text,
 add constraint qb_task_date_order check(start_date is null or due_date is null or start_date<=due_date),
 add constraint qb_one_assignee check(assignee_id is null or assignee_invitation_id is null);
create index qb_tasks_invited_owner on public.qb_tasks(assignee_invitation_id) where assignee_invitation_id is not null;
grant update(start_date,estimated_hours,remaining_hours,schedule_mode,schedule_offset,duration_days,assignee_invitation_id) on public.qb_tasks to authenticated;
alter table public.qb_milestones
 add column start_date date,
 add column estimated_hours numeric(8,2) check(estimated_hours between 0 and 100000),
 add column schedule_mode text not null default 'fixed' check(schedule_mode in ('fixed','project')),
 add column schedule_offset integer not null default 0 check(schedule_offset between -3650 and 3650),
 add column duration_days integer not null default 1 check(duration_days between 1 and 3650),
 add constraint qb_milestone_date_order check(start_date is null or start_date<=due_date);
grant update(start_date,estimated_hours,schedule_mode,schedule_offset,duration_days) on public.qb_milestones to authenticated;

create function qb_private.planning_scope_read(p_type text,p_id uuid,p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select qb_private.is_org_member(p_org) and case p_type
 when 'organization' then p_id=p_org
 when 'department' then exists(select 1 from public.qb_departments where id=p_id and org_id=p_org)
 when 'project' then exists(select 1 from public.qb_projects where id=p_id and org_id=p_org and qb_private.can_view_project(id)) else false end;
$$;
create function qb_private.planning_scope_manage(p_type text,p_id uuid,p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select qb_private.planning_scope_read(p_type,p_id,p_org) and case p_type
 when 'organization' then qb_private.is_org_admin(p_org)
 when 'department' then qb_private.is_department_manager(p_id)
 when 'project' then qb_private.can_manage_project(p_id) else false end;
$$;
create function qb_private.valid_planning_settings(v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; n numeric;
begin
 if v is null or jsonb_typeof(v)<>'object' then return false; end if;
 for k in select jsonb_object_keys(v) loop
  if k not in ('weekly_capacity_hours','default_estimated_hours','default_duration_days','workdays') then return false; end if;
  if k='workdays' then
   if jsonb_typeof(v->k)<>'array' then return false; end if;
   if jsonb_array_length(v->k) not between 1 and 7 then return false; end if;
   if exists(select 1 from jsonb_array_elements(v->k) d where jsonb_typeof(d)<>'number' or d::text not in ('0','1','2','3','4','5','6')) then return false; end if;
   if (select count(distinct d) from jsonb_array_elements(v->k) d)<>jsonb_array_length(v->k) then return false; end if;
  else
   if jsonb_typeof(v->k)<>'number' then return false; end if;
   n:=(v->>k)::numeric;
   if k='weekly_capacity_hours' and (n<0 or n>168) then return false; end if;
   if k='default_estimated_hours' and (n<0 or n>100000) then return false; end if;
   if k='default_duration_days' and (n<1 or n>3650 or n<>trunc(n)) then return false; end if;
  end if;
 end loop;
 return true;
end;
$$;
create table public.qb_planning_settings(
 org_id uuid not null references public.qb_organizations(id),
 scope_type text not null check(scope_type in ('organization','department','project')),
 scope_id uuid not null,
 values jsonb not null default '{}' check(qb_private.valid_planning_settings(values)),
 revision integer not null default 1,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 primary key(scope_type,scope_id)
);
create index qb_planning_settings_org on public.qb_planning_settings(org_id);
create index qb_planning_settings_actor on public.qb_planning_settings(updated_by);
alter table public.qb_planning_settings enable row level security;
revoke all on public.qb_planning_settings from public,anon,authenticated;
grant select,insert on public.qb_planning_settings to authenticated;
grant update(values,updated_by,updated_at,revision) on public.qb_planning_settings to authenticated;
create policy qb_plan_settings_read on public.qb_planning_settings for select to authenticated using(qb_private.planning_scope_read(scope_type,scope_id,org_id));
create policy qb_plan_settings_insert on public.qb_planning_settings for insert to authenticated with check(qb_private.planning_scope_manage(scope_type,scope_id,org_id) and updated_by=auth.uid());
create policy qb_plan_settings_update on public.qb_planning_settings for update to authenticated using(qb_private.planning_scope_manage(scope_type,scope_id,org_id)) with check(qb_private.planning_scope_manage(scope_type,scope_id,org_id) and updated_by=auth.uid());
create function public.qb_save_planning_settings(p_org uuid,p_type text,p_scope uuid,p_values jsonb,p_revision integer default 0) returns void
language plpgsql security invoker set search_path='' as $$
declare old_revision integer;
begin
 if auth.uid() is null or not qb_private.planning_scope_manage(p_type,p_scope,p_org) then raise exception 'Settings unavailable' using errcode='42501'; end if;
 if not qb_private.valid_planning_settings(p_values) then raise exception 'Invalid planning settings' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-settings:'||p_type||p_scope::text,0));
 select revision into old_revision from public.qb_planning_settings where scope_type=p_type and scope_id=p_scope for update;
 if coalesce(old_revision,0) is distinct from p_revision then raise exception 'Settings changed. Refresh before saving.' using errcode='40001'; end if;
 insert into public.qb_planning_settings(org_id,scope_type,scope_id,values,updated_by) values(p_org,p_type,p_scope,p_values,auth.uid())
 on conflict(scope_type,scope_id) do update set values=excluded.values,revision=public.qb_planning_settings.revision+1,updated_by=auth.uid(),updated_at=now();
end;
$$;
-- Individual capacity is organization-wide; only organization administrators can set it.
create table public.qb_staff_capacity(
 org_id uuid not null references public.qb_organizations(id),
 owner_key text not null check(owner_key ~ '^(user|invite):[0-9a-f-]{36}$'),
 weekly_hours numeric(5,2) not null check(weekly_hours between 0 and 168),
 primary key(org_id,owner_key)
);
alter table public.qb_staff_capacity enable row level security;
revoke all on public.qb_staff_capacity from public,anon,authenticated;
grant select,insert,update,delete on public.qb_staff_capacity to authenticated;
create policy qb_capacity_read on public.qb_staff_capacity for select to authenticated using(qb_private.is_org_member(org_id));
create policy qb_capacity_write on public.qb_staff_capacity for all to authenticated using(qb_private.is_org_admin(org_id)) with check(qb_private.is_org_admin(org_id));

create function qb_private.guard_staff_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 owner_id:=split_part(new.owner_key,':',2)::uuid;
 if not (split_part(new.owner_key,':',1)='user' and exists(select 1 from public.qb_org_members where org_id=new.org_id and user_id=owner_id)
 or split_part(new.owner_key,':',1)='invite' and exists(select 1 from public.qb_invitations where org_id=new.org_id and id=owner_id)) then
 raise exception 'Capacity owner must belong to this organization' using errcode='42501';end if;
 return new;
end;$$;
create trigger qb_capacity_owner before insert or update on public.qb_staff_capacity for each row execute function qb_private.guard_staff_capacity();
revoke all on function qb_private.guard_staff_capacity() from public,anon,authenticated;

-- Invited owners do not grant access, create accounts, or participate in approval.
create function public.qb_invited_assignment_candidates(p_project uuid)
returns table(id uuid,invited_email text,status text,expires_at timestamptz,accepted_by uuid)
language sql stable security definer set search_path='' as $$
 select i.id,i.invited_email,i.status,i.expires_at,i.accepted_by from public.qb_invitations i join public.qb_projects p on p.org_id=i.org_id
 where p.id=p_project and qb_private.can_manage_project(p.id) and qb_private.can_view_project(p.id)
 and i.status<>'revoked' and (i.scope_type='organization' or i.scope_type='department' and i.scope_id=p.department_id or i.scope_type='project' and i.scope_id=p.id)
 and (i.status='pending' or not qb_private.user_can_access_project(p.id,i.accepted_by));
$$;
create function qb_private.guard_planned_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare i public.qb_invitations%rowtype; p public.qb_projects%rowtype;
begin
 if new.assignee_invitation_id is null then new.planned_assignee_label:=null;return new;end if;
 if tg_op='UPDATE' and new.assignee_invitation_id is not distinct from old.assignee_invitation_id and new.project_id=old.project_id then
  new.planned_assignee_label:=old.planned_assignee_label;return new;
 end if;
 select * into i from public.qb_invitations where id=new.assignee_invitation_id for share;
 select * into p from public.qb_projects where id=new.project_id;
 if i.id is null or i.org_id<>p.org_id or i.status='revoked' or not (i.scope_type='organization' or i.scope_type='department' and i.scope_id=p.department_id or i.scope_type='project' and i.scope_id=p.id) then
  raise exception 'Invited person is unavailable for this project' using errcode='42501';
 end if;
 new.planned_assignee_label:=i.invited_email;
 return new;
end;
$$;
create trigger qb_task_planned_owner before insert or update on public.qb_tasks for each row execute function qb_private.guard_planned_owner();

-- Resolve relative end dates; durations count calendar days, including both ends.
create function qb_private.resolve_task_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare anchor date;
begin
 if new.schedule_mode='fixed' then return new; end if;
 if tg_op='UPDATE' and old.status in ('complete','cancelled') and new.status=old.status
 and (new.schedule_mode,new.schedule_offset,new.duration_days,new.milestone_id,new.start_date,new.due_date) is not distinct from (old.schedule_mode,old.schedule_offset,old.duration_days,old.milestone_id,old.start_date,old.due_date) then return new;end if;
 if new.schedule_mode in ('milestone','milestone_deadline') then
  select due_date into anchor from public.qb_milestones where id=new.milestone_id and project_id=new.project_id;
 else select target_date into anchor from public.qb_projects where id=new.project_id;end if;
 if anchor is null then raise exception 'Relative dates need a dated milestone or project target' using errcode='22023';end if;
 if new.schedule_mode='milestone_deadline' then new.due_date:=anchor;else
 new.due_date:=anchor+new.schedule_offset;new.start_date:=new.due_date-new.duration_days+1;end if;
 return new;
end;
$$;
create trigger qb_task_schedule before insert or update on public.qb_tasks for each row execute function qb_private.resolve_task_schedule();
create function qb_private.resolve_milestone_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare anchor date;
begin
 if new.schedule_mode='fixed' then return new;end if;
 select target_date into anchor from public.qb_projects where id=new.project_id;
 if anchor is null then raise exception 'Set the project target before using relative milestone dates' using errcode='22023';end if;
 if new.schedule_mode='milestone_deadline' then new.due_date:=anchor;else
 new.due_date:=anchor+new.schedule_offset;new.start_date:=new.due_date-new.duration_days+1;end if;return new;
end;
$$;
create trigger qb_milestone_schedule before insert or update on public.qb_milestones for each row execute function qb_private.resolve_milestone_schedule();
-- Trigger-only elevation propagates dates even for hidden tasks; no extra content is returned.
create function qb_private.propagate_planning_dates() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='qb_projects' then
  if new.target_date is not distinct from old.target_date then return new;end if;
  update public.qb_milestones set due_date=due_date where project_id=new.id and schedule_mode='project' and not archived;
  update public.qb_tasks set due_date=due_date where project_id=new.id and schedule_mode='project' and status not in ('complete','cancelled');
 else
  if new.due_date is not distinct from old.due_date then return new;end if;
  update public.qb_tasks set due_date=due_date where milestone_id=new.id and schedule_mode in ('milestone','milestone_deadline') and status not in ('complete','cancelled');
 end if;
 return new;
end;
$$;
create trigger qb_project_plan_dates after update of target_date on public.qb_projects for each row execute function qb_private.propagate_planning_dates();
create trigger qb_milestone_plan_dates after update on public.qb_milestones for each row execute function qb_private.propagate_planning_dates();
create function qb_private.audit_task_plan() returns trigger language plpgsql security definer set search_path='' as $$
declare before_values jsonb; after_values jsonb;
begin
 before_values:=jsonb_build_object('start_date',old.start_date,'estimated_hours',old.estimated_hours,'remaining_hours',old.remaining_hours,'schedule_mode',old.schedule_mode,'schedule_offset',old.schedule_offset,'duration_days',old.duration_days,'invited_owner',old.planned_assignee_label,'vendor',jsonb_build_object('vendor_id',old.vendor_id,'contact_id',old.vendor_contact_id,'dependent',old.vendor_dependent,'reference',old.vendor_reference,'notes',old.vendor_notes,'follow_up',old.vendor_followup_date,'last_contacted',old.vendor_last_contacted));
 after_values:=jsonb_build_object('start_date',new.start_date,'estimated_hours',new.estimated_hours,'remaining_hours',new.remaining_hours,'schedule_mode',new.schedule_mode,'schedule_offset',new.schedule_offset,'duration_days',new.duration_days,'invited_owner',new.planned_assignee_label,'vendor',jsonb_build_object('vendor_id',new.vendor_id,'contact_id',new.vendor_contact_id,'dependent',new.vendor_dependent,'reference',new.vendor_reference,'notes',new.vendor_notes,'follow_up',new.vendor_followup_date,'last_contacted',new.vendor_last_contacted));
 if before_values is distinct from after_values then
  insert into public.qb_task_events(task_id,actor_id,event_type,before_data,after_data) values(new.id,auth.uid(),'planning',before_values,after_values);
 end if;return new;
end;
$$;
create trigger qb_task_plan_audit after update on public.qb_tasks for each row execute function qb_private.audit_task_plan();

create function public.qb_save_task_plan(p_task uuid,p_plan jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.qb_tasks where id=p_task and qb_private.can_manage_project(project_id)) then raise exception 'Task planning unavailable' using errcode='42501';end if;
 update public.qb_tasks set start_date=(p_plan->>'start_date')::date,estimated_hours=(p_plan->>'estimated_hours')::numeric,
 remaining_hours=(p_plan->>'remaining_hours')::numeric,schedule_mode=coalesce(p_plan->>'schedule_mode','fixed'),
 schedule_offset=coalesce((p_plan->>'schedule_offset')::integer,0),duration_days=coalesce((p_plan->>'duration_days')::integer,1),
 vendor_dependent=coalesce((p_plan->>'vendor_dependent')::boolean,false),vendor_id=(p_plan->>'vendor_id')::uuid,vendor_contact_id=(p_plan->>'vendor_contact_id')::uuid,
 vendor_reference=coalesce(p_plan->>'vendor_reference',''),vendor_notes=coalesce(p_plan->>'vendor_notes',''),vendor_followup_date=(p_plan->>'vendor_followup_date')::date,vendor_last_contacted=(p_plan->>'vendor_last_contacted')::date,
 assignee_invitation_id=(p_plan->>'assignee_invitation_id')::uuid where id=p_task;
end;
$$;
create function public.qb_create_planned_task(p_request uuid,p_project uuid,p_values jsonb,p_template uuid default null,p_prerequisite uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('qb-template-task:'||p_request::text,0));
 -- Existing creation endpoint supplies request identity, scope and template validation.
 if exists(select 1 from public.qb_tasks where id=p_request) then
  if not exists(select 1 from public.qb_tasks where id=p_request and project_id=p_project and created_by=auth.uid()) or not qb_private.can_manage_project(p_project) then raise exception 'Request unavailable' using errcode='42501';end if;
  return p_request;
 end if;
 result:=public.qb_create_milestone_task(p_project,p_request,(p_values->>'milestone_id')::uuid,p_template,p_values->>'title',coalesce(p_values->>'description',''),coalesce(p_values->>'priority','normal'),(p_values->>'due_date')::date,(p_values->>'assignee_id')::uuid,coalesce((p_values->>'xp_reward')::integer,30),p_prerequisite);
 perform public.qb_save_task_plan(result,p_values);return result;
end;
$$;
create function public.qb_save_planned_milestone(p_id uuid,p_project uuid,p_values jsonb,p_revision integer default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; anchor date; target date;
begin
 target:=(p_values->>'due_date')::date;
 if p_values->>'schedule_mode'='project' then select target_date into anchor from public.qb_projects where id=p_project;target:=anchor+coalesce((p_values->>'schedule_offset')::integer,0);end if;
 if target is null then raise exception 'Choose a target date or a dated project anchor' using errcode='22023';end if;
 -- Reset previous planning in the same transaction so old offsets cannot overwrite new dates.
 if p_revision is not null then
  perform 1 from public.qb_milestones where id=p_id and project_id=p_project and revision=p_revision for update;
  if not found then raise exception 'Milestone changed. Reload before editing again.' using errcode='40001';end if;
  if not qb_private.can_manage_project(p_project) then raise exception 'Milestone unavailable' using errcode='42501';end if;
  update public.qb_milestones set schedule_mode='fixed',start_date=null where id=p_id;
  p_revision:=p_revision+1;
 end if;
 result:=public.qb_save_milestone(p_id,p_project,p_values->>'title',coalesce(p_values->>'description',''),target,coalesce((p_values->>'archived')::boolean,false),p_revision);
 update public.qb_milestones set vendor_dependent=coalesce((p_values->>'vendor_dependent')::boolean,false),vendor_id=(p_values->>'vendor_id')::uuid,vendor_contact_id=(p_values->>'vendor_contact_id')::uuid,
 vendor_reference=coalesce(p_values->>'vendor_reference',''),vendor_notes=coalesce(p_values->>'vendor_notes',''),vendor_followup_date=(p_values->>'vendor_followup_date')::date,vendor_last_contacted=(p_values->>'vendor_last_contacted')::date,
 start_date=(p_values->>'start_date')::date,estimated_hours=(p_values->>'estimated_hours')::numeric,
 schedule_mode=coalesce(p_values->>'schedule_mode','fixed'),schedule_offset=coalesce((p_values->>'schedule_offset')::integer,0),duration_days=coalesce((p_values->>'duration_days')::integer,1) where id=result;
 return result;
end;
$$;
-- Reconcile only already-authorized accounts. Organization invitations alone grant no project access.
create function qb_private.reconcile_planned_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 if tg_table_name='qb_invitations' then
  if new.status<>'accepted' then return new;end if;person:=new.accepted_by;
 else person:=new.user_id;end if;
 if person is null then return new;end if;
 insert into public.qb_staff_capacity(org_id,owner_key,weekly_hours)
 select distinct on (c.org_id) c.org_id,'user:'||person::text,c.weekly_hours from public.qb_staff_capacity c join public.qb_invitations i on c.owner_key='invite:'||i.id::text and c.org_id=i.org_id
 where i.accepted_by=person and i.status='accepted' order by c.org_id,i.created_at desc
 on conflict(org_id,owner_key) do nothing;
 update public.qb_tasks t set assignee_id=person,assignee_invitation_id=null
 from public.qb_invitations i where t.assignee_invitation_id=i.id and i.accepted_by=person and i.status='accepted'
 and t.status not in ('complete','cancelled') and qb_private.user_can_access_project(t.project_id,person)
 and (t.visibility<>'restricted' or exists(select 1 from public.qb_task_participants tp where tp.task_id=t.id and tp.user_id=person));
 return new;
end;
$$;
create trigger qb_invitation_plan_owner after update of status on public.qb_invitations for each row execute function qb_private.reconcile_planned_owner();
create trigger qb_project_member_plan_owner after insert or update on public.qb_project_members for each row execute function qb_private.reconcile_planned_owner();
create trigger qb_task_participant_plan_owner after insert or update on public.qb_task_participants for each row execute function qb_private.reconcile_planned_owner();
create trigger qb_department_member_plan_owner after insert or update on public.qb_department_members for each row execute function qb_private.reconcile_planned_owner();

revoke all on function qb_private.planning_scope_read(text,uuid,uuid),qb_private.planning_scope_manage(text,uuid,uuid),qb_private.valid_planning_settings(jsonb) from public,anon;
grant execute on function qb_private.planning_scope_read(text,uuid,uuid),qb_private.planning_scope_manage(text,uuid,uuid),qb_private.valid_planning_settings(jsonb) to authenticated;
revoke all on function qb_private.guard_planned_owner(),qb_private.resolve_task_schedule(),qb_private.resolve_milestone_schedule(),qb_private.propagate_planning_dates(),qb_private.audit_task_plan(),qb_private.reconcile_planned_owner() from public,anon,authenticated;
revoke all on function public.qb_invited_assignment_candidates(uuid),public.qb_save_task_plan(uuid,jsonb),public.qb_create_planned_task(uuid,uuid,jsonb,uuid,uuid),public.qb_save_planned_milestone(uuid,uuid,jsonb,integer),public.qb_save_planning_settings(uuid,text,uuid,jsonb,integer) from public,anon;
grant execute on function public.qb_invited_assignment_candidates(uuid),public.qb_save_task_plan(uuid,jsonb),public.qb_create_planned_task(uuid,uuid,jsonb,uuid,uuid),public.qb_save_planned_milestone(uuid,uuid,jsonb,integer),public.qb_save_planning_settings(uuid,text,uuid,jsonb,integer) to authenticated;
-- Organization vendor directory. Business contacts are shared within the organization.
create function qb_private.can_manage_vendors(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select qb_private.is_org_member(p_org) and (qb_private.is_org_admin(p_org)
 or exists(select 1 from public.qb_departments d where d.org_id=p_org and qb_private.is_department_manager(d.id))
 or exists(select 1 from public.qb_projects p where p.org_id=p_org and qb_private.can_manage_project(p.id) and qb_private.can_view_project(p.id)));
$$;
revoke all on function qb_private.can_manage_vendors(uuid) from public,anon;
grant execute on function qb_private.can_manage_vendors(uuid) to authenticated;
create table public.qb_vendors(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.qb_organizations(id),
 name text not null check(length(btrim(name)) between 1 and 160),notes text not null default '' check(length(notes)<=2500),
 archived boolean not null default false,created_at timestamptz not null default now(),unique(id,org_id)
);
create index qb_vendors_org on public.qb_vendors(org_id);
create table public.qb_vendor_contacts(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.qb_organizations(id),vendor_id uuid not null,
 name text not null check(length(btrim(name)) between 1 and 160),email text not null default '' check(length(email)<=320),
 phone text not null default '' check(length(phone)<=80),role text not null default '' check(length(role)<=160),
 archived boolean not null default false,foreign key(vendor_id,org_id) references public.qb_vendors(id,org_id),unique(id,vendor_id)
);
create index qb_vendor_contacts_org on public.qb_vendor_contacts(org_id);
create index qb_vendor_contacts_vendor on public.qb_vendor_contacts(vendor_id,org_id);
alter table public.qb_vendors enable row level security;
alter table public.qb_vendor_contacts enable row level security;
revoke all on public.qb_vendors,public.qb_vendor_contacts from public,anon,authenticated;
grant select,insert on public.qb_vendors,public.qb_vendor_contacts to authenticated;
grant update(name,notes,archived) on public.qb_vendors to authenticated;
grant update(name,email,phone,role,archived) on public.qb_vendor_contacts to authenticated;
create policy qb_vendors_read on public.qb_vendors for select to authenticated using(qb_private.is_org_member(org_id));
create policy qb_vendors_insert on public.qb_vendors for insert to authenticated with check(qb_private.can_manage_vendors(org_id));
create policy qb_vendors_update on public.qb_vendors for update to authenticated using(qb_private.can_manage_vendors(org_id)) with check(qb_private.can_manage_vendors(org_id));
create policy qb_vendor_contacts_read on public.qb_vendor_contacts for select to authenticated using(qb_private.is_org_member(org_id));
create policy qb_vendor_contacts_insert on public.qb_vendor_contacts for insert to authenticated with check(qb_private.can_manage_vendors(org_id));
create policy qb_vendor_contacts_update on public.qb_vendor_contacts for update to authenticated using(qb_private.can_manage_vendors(org_id)) with check(qb_private.can_manage_vendors(org_id));
alter table public.qb_tasks
 add column vendor_dependent boolean not null default false,
 add column vendor_id uuid references public.qb_vendors(id),
 add column vendor_contact_id uuid,
 add column vendor_reference text not null default '' check(length(vendor_reference)<=240),
 add column vendor_notes text not null default '' check(length(vendor_notes)<=2500),
 add column vendor_followup_date date,
 add column vendor_last_contacted date,
 add foreign key(vendor_contact_id,vendor_id) references public.qb_vendor_contacts(id,vendor_id),
 add check(vendor_contact_id is null or vendor_id is not null);
alter table public.qb_milestones
 add column vendor_dependent boolean not null default false,
 add column vendor_id uuid references public.qb_vendors(id),
 add column vendor_contact_id uuid,
 add column vendor_reference text not null default '' check(length(vendor_reference)<=240),
 add column vendor_notes text not null default '' check(length(vendor_notes)<=2500),
 add column vendor_followup_date date,
 add column vendor_last_contacted date,
 add foreign key(vendor_contact_id,vendor_id) references public.qb_vendor_contacts(id,vendor_id),
 add check(vendor_contact_id is null or vendor_id is not null);
create index qb_tasks_vendor on public.qb_tasks(vendor_id);
create index qb_tasks_vendor_contact on public.qb_tasks(vendor_contact_id,vendor_id);
create index qb_milestones_vendor on public.qb_milestones(vendor_id);
create index qb_milestones_vendor_contact on public.qb_milestones(vendor_contact_id,vendor_id);
grant update(vendor_dependent,vendor_id,vendor_contact_id,vendor_reference,vendor_notes,vendor_followup_date,vendor_last_contacted) on public.qb_tasks,public.qb_milestones to authenticated;
create function qb_private.guard_work_vendor() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.vendor_id is not null and not exists(select 1 from public.qb_vendors v join public.qb_projects p on p.org_id=v.org_id where v.id=new.vendor_id and p.id=new.project_id) then
  raise exception 'Vendor must belong to this organization' using errcode='42501';end if;
 if not new.vendor_dependent and (new.vendor_id is not null or new.vendor_contact_id is not null) then raise exception 'Mark this work vendor dependent before assigning a vendor' using errcode='22023';end if;
 return new;
end;$$;
create trigger qb_task_vendor before insert or update on public.qb_tasks for each row execute function qb_private.guard_work_vendor();
create trigger qb_milestone_vendor before insert or update on public.qb_milestones for each row execute function qb_private.guard_work_vendor();
revoke all on function qb_private.guard_work_vendor() from public,anon,authenticated;
-- Validate the final transaction state, allowing relative children to move atomically.
create function qb_private.check_milestone_timeframe() returns trigger language plpgsql security definer set search_path='' as $$
declare milestone uuid;
begin
 if tg_table_name='qb_tasks' then
  if tg_op='UPDATE' and (new.start_date,new.due_date,new.milestone_id,new.schedule_mode,new.status) is not distinct from (old.start_date,old.due_date,old.milestone_id,old.schedule_mode,old.status) then return null;end if;
  select milestone_id into milestone from public.qb_tasks where id=new.id;
 else
  if (new.start_date,new.due_date) is not distinct from (old.start_date,old.due_date) then return null;end if;
  milestone:=new.id;
 end if;
 if exists(select 1 from public.qb_tasks t join public.qb_milestones m on m.id=t.milestone_id where m.id=milestone and t.status not in ('complete','cancelled')
 and (t.due_date>m.due_date or t.start_date>m.due_date or t.start_date<m.start_date or t.due_date<m.start_date)) then
  raise exception 'Open task dates must fit within the milestone time frame. Adjust task dates or expand the milestone first.' using errcode='22023';end if;
 return null;
end;$$;
create constraint trigger qb_task_timeframe after insert or update on public.qb_tasks deferrable initially deferred for each row execute function qb_private.check_milestone_timeframe();
create constraint trigger qb_milestone_timeframe after update on public.qb_milestones deferrable initially deferred for each row execute function qb_private.check_milestone_timeframe();
revoke all on function qb_private.check_milestone_timeframe() from public,anon,authenticated;

commit;
