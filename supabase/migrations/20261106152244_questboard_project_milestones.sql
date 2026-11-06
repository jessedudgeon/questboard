begin;
create table public.qb_milestones (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.qb_projects(id),
 title text not null check(char_length(btrim(title)) between 1 and 160),
 description text not null default '' check(char_length(description)<=2500),
 due_date date not null,
 archived boolean not null default false,
 revision integer not null default 1,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(id,project_id)
);
create index qb_milestones_project on public.qb_milestones(project_id);
alter table public.qb_milestones enable row level security;
revoke all on public.qb_milestones from public,anon,authenticated;
grant select,insert on public.qb_milestones to authenticated;
grant update(title,description,due_date,archived) on public.qb_milestones to authenticated;
create policy qb_milestones_read on public.qb_milestones for select to authenticated using(qb_private.can_view_project(project_id));
create policy qb_milestones_insert on public.qb_milestones for insert to authenticated with check(qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id) and created_by=(select auth.uid()));
create policy qb_milestones_update on public.qb_milestones for update to authenticated using(qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id)) with check(qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id));
create function qb_private.guard_milestone() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.project_id,new.created_by,new.created_at) is distinct from (old.id,old.project_id,old.created_by,old.created_at) then
  raise exception 'Milestone identity cannot change' using errcode='22023';
 end if;
 new.revision:=old.revision+1;
 return new;
end;
$$;
create trigger qb_milestone_guard before update on public.qb_milestones for each row execute function qb_private.guard_milestone();
alter table public.qb_tasks add column milestone_id uuid;
alter table public.qb_tasks add constraint qb_task_milestone_project foreign key(milestone_id,project_id) references public.qb_milestones(id,project_id);
create index qb_tasks_milestone on public.qb_tasks(milestone_id,project_id) where milestone_id is not null;
grant update(milestone_id) on public.qb_tasks to authenticated;
create function qb_private.guard_task_milestone() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.milestone_id is not distinct from old.milestone_id then return new; end if;
 if new.milestone_id is not null then
  perform 1 from public.qb_milestones where id=new.milestone_id and project_id=new.project_id and not archived for share;
  if not found then raise exception 'Choose an active milestone in this project' using errcode='42501'; end if;
 end if;
 return new;
end;
$$;
create trigger qb_task_milestone_guard before insert or update on public.qb_tasks for each row execute function qb_private.guard_task_milestone();
create function public.qb_save_milestone(p_id uuid,p_project uuid,p_title text,p_description text,p_due_date date,p_archived boolean,p_revision integer default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare milestone public.qb_milestones%rowtype;
begin
 if auth.uid() is null or not qb_private.can_manage_project(p_project) or not qb_private.can_view_project(p_project) then raise exception 'Milestone management unavailable' using errcode='42501'; end if;
 if p_id is null then raise exception 'Request ID required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-milestone:'||p_id::text,0));
 select * into milestone from public.qb_milestones where id=p_id for update;
 if p_revision is null then
  if found then
   if milestone.project_id<>p_project or milestone.created_by<>auth.uid() then raise exception 'Request ID already used' using errcode='22023'; end if;
   return p_id;
  end if;
  insert into public.qb_milestones(id,project_id,title,description,due_date,created_by)
  values(p_id,p_project,btrim(p_title),p_description,p_due_date,auth.uid());
 else
  if not found or milestone.project_id<>p_project then raise exception 'Milestone unavailable' using errcode='42501'; end if;
  if milestone.revision<>p_revision then raise exception 'Milestone changed. Reload before editing again.' using errcode='40001'; end if;
  update public.qb_milestones set title=btrim(p_title),description=p_description,due_date=p_due_date,archived=p_archived where id=p_id;
 end if;
 return p_id;
end;
$$;
create function public.qb_create_milestone_task(p_project uuid,p_request uuid,p_milestone uuid,p_template uuid,p_title text,p_description text,p_priority text,p_due_date date,p_assignee uuid,p_xp_reward integer,p_prerequisite uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing public.qb_tasks%rowtype;
begin
 if auth.uid() is null or not qb_private.can_manage_project(p_project) or not qb_private.can_view_project(p_project) then raise exception 'Task creation unavailable' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request ID required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-template-task:'||p_request::text,0));
 select * into existing from public.qb_tasks where id=p_request;
 if found then
  if existing.created_by<>auth.uid() or existing.project_id<>p_project or existing.milestone_id is distinct from p_milestone or existing.source_template_id is distinct from p_template then raise exception 'Request ID already used' using errcode='22023'; end if;
  return p_request;
 end if;
 if p_template is not null then
  if not exists(select 1 from public.qb_task_templates where id=p_template and project_id=p_project) then raise exception 'Template unavailable for this project' using errcode='42501'; end if;
  perform public.qb_create_template_task(p_template,p_request,p_title,p_description,p_priority,p_due_date,p_assignee,p_xp_reward,p_prerequisite);
  update public.qb_tasks set milestone_id=p_milestone where id=p_request;
 else
  insert into public.qb_tasks(id,project_id,title,description,priority,due_date,assignee_id,reviewer_id,xp_reward,created_by,milestone_id)
  values(p_request,p_project,p_title,p_description,p_priority,p_due_date,p_assignee,auth.uid(),p_xp_reward,auth.uid(),p_milestone);
  if p_prerequisite is not null then perform public.qb_set_task_dependency(p_request,p_prerequisite,true); end if;
 end if;
 return p_request;
end;
$$;
revoke all on function qb_private.guard_milestone(),qb_private.guard_task_milestone() from public,anon;
revoke all on function public.qb_save_milestone(uuid,uuid,text,text,date,boolean,integer),public.qb_create_milestone_task(uuid,uuid,uuid,uuid,text,text,text,date,uuid,integer,uuid) from public,anon;
grant execute on function public.qb_save_milestone(uuid,uuid,text,text,date,boolean,integer),public.qb_create_milestone_task(uuid,uuid,uuid,uuid,text,text,text,date,uuid,integer,uuid) to authenticated;
commit;
