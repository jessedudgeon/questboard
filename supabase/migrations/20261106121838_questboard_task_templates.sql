begin;
create table public.qb_task_templates (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.qb_projects(id),
 name text not null check (char_length(btrim(name)) between 1 and 120),
 title text not null,
 description text not null default '',
 priority text not null check(priority in ('low','normal','high','critical')),
 xp_reward integer not null check(xp_reward between 0 and 500),
 due_days integer check(due_days between 0 and 3650),
 checklist text[] not null default '{}',
 archived boolean not null default false,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index qb_task_templates_project on public.qb_task_templates(project_id);
alter table public.qb_task_templates enable row level security;
revoke all on public.qb_task_templates from public,anon,authenticated;
grant select,insert on public.qb_task_templates to authenticated;
grant update(archived) on public.qb_task_templates to authenticated;
create policy qb_templates_read on public.qb_task_templates for select to authenticated
 using(qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id));
create policy qb_templates_insert on public.qb_task_templates for insert to authenticated
 with check(qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id) and created_by=(select auth.uid()));
create policy qb_templates_update on public.qb_task_templates for update to authenticated
 using(qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id))
 with check(qb_private.can_manage_project(project_id) and qb_private.can_view_project(project_id));

alter table public.qb_tasks add column source_template_id uuid references public.qb_task_templates(id);
create index qb_tasks_source_template on public.qb_tasks(source_template_id) where source_template_id is not null;
create function qb_private.guard_task_template() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.source_template_id is distinct from old.source_template_id then
  raise exception 'Task template origin cannot change' using errcode='22023';
 end if;
 if tg_op='INSERT' and new.source_template_id is not null and not exists(
  select 1 from public.qb_task_templates where id=new.source_template_id and project_id=new.project_id and not archived
 ) then raise exception 'Template unavailable for this project' using errcode='42501'; end if;
 return new;
end;
$$;
create trigger qb_task_template_guard before insert or update on public.qb_tasks
 for each row execute function qb_private.guard_task_template();

create function public.qb_save_task_template(p_task uuid,p_name text,p_due_days integer,p_request uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare source public.qb_tasks%rowtype; existing public.qb_task_templates%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request ID required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-template:'||p_request::text,0));
 select * into source from public.qb_tasks where id=p_task for update;
 if not found or source.visibility='restricted' or not qb_private.can_manage_project(source.project_id) then
  raise exception 'Choose a shared task in a project you manage' using errcode='42501';
 end if;
 select * into existing from public.qb_task_templates where id=p_request;
 if found then
  if existing.project_id<>source.project_id or existing.created_by<>auth.uid() then
   raise exception 'Request ID already used' using errcode='22023';
  end if;
  return existing.id;
 end if;
 insert into public.qb_task_templates(id,project_id,name,title,description,priority,xp_reward,due_days,checklist,created_by)
 select p_request,source.project_id,btrim(p_name),source.title,source.description,source.priority,source.xp_reward,p_due_days,
 coalesce((select array_agg(title order by position,id) from public.qb_checklist where task_id=p_task),'{}'),auth.uid();
 return p_request;
end;
$$;

create function public.qb_create_template_task(
 p_template uuid,p_request uuid,p_title text,p_description text,p_priority text,
 p_due_date date,p_assignee uuid,p_xp_reward integer,p_prerequisite uuid default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare template public.qb_task_templates%rowtype; existing public.qb_tasks%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_request is null then raise exception 'Request ID required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-template-task:'||p_request::text,0));
 select * into template from public.qb_task_templates where id=p_template for share;
 if not found then raise exception 'Template unavailable' using errcode='42501'; end if;
 select * into existing from public.qb_tasks where id=p_request;
 if found then
  if existing.created_by<>auth.uid() or existing.source_template_id is distinct from p_template then
   raise exception 'Request ID already used' using errcode='22023';
  end if;
  return existing.id;
 end if;
 if template.archived then raise exception 'Template is archived' using errcode='55000'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 160 then
  raise exception 'Enter a task title between 1 and 160 characters' using errcode='22023';
 end if;
 insert into public.qb_tasks(id,project_id,title,description,priority,due_date,assignee_id,reviewer_id,xp_reward,created_by,source_template_id)
 values(p_request,template.project_id,btrim(p_title),p_description,p_priority,p_due_date,p_assignee,auth.uid(),p_xp_reward,auth.uid(),template.id);
 insert into public.qb_checklist(task_id,title,position)
 select p_request,item,ordinality::integer-1 from unnest(template.checklist) with ordinality as checklist(item,ordinality);
 if p_prerequisite is not null then perform public.qb_set_task_dependency(p_request,p_prerequisite,true); end if;
 return p_request;
end;
$$;
revoke all on function public.qb_save_task_template(uuid,text,integer,uuid),public.qb_create_template_task(uuid,uuid,text,text,text,date,uuid,integer,uuid) from public,anon;
grant execute on function public.qb_save_task_template(uuid,text,integer,uuid),public.qb_create_template_task(uuid,uuid,text,text,text,date,uuid,integer,uuid) to authenticated;
revoke all on function qb_private.guard_task_template() from public,anon;
commit;
