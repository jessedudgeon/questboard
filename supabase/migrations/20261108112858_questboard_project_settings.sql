begin;
set local lock_timeout='5s';
alter table public.qb_projects add column revision integer not null default 1;
create table public.qb_project_changes (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.qb_projects(id),
 actor_id uuid references auth.users(id),
 revision integer not null,
 before_data jsonb not null,
 after_data jsonb not null,
 created_at timestamptz not null default now(),
 unique(project_id,revision)
);
create index qb_project_changes_actor on public.qb_project_changes(actor_id);
alter table public.qb_project_changes enable row level security;
revoke all on public.qb_project_changes from public,anon,authenticated;
grant select on public.qb_project_changes to authenticated;
create policy qb_project_changes_read on public.qb_project_changes for select to authenticated
 using(qb_private.can_view_project(project_id));

create function qb_private.version_project() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.revision:=old.revision+1;
 new.updated_at:=clock_timestamp();
 return new;
end;
$$;
create trigger qb_project_version before update on public.qb_projects for each row execute function qb_private.version_project();
-- Trigger-only elevation writes an immutable audit row without giving clients INSERT.
create function qb_private.audit_project_settings() returns trigger language plpgsql security definer set search_path='' as $$
declare before_values jsonb; after_values jsonb;
begin
 before_values:=jsonb_build_object('title',old.title,'summary',old.summary,'status',old.status,'target_date',old.target_date);
 after_values:=jsonb_build_object('title',new.title,'summary',new.summary,'status',new.status,'target_date',new.target_date);
 if before_values is distinct from after_values then
  insert into public.qb_project_changes(project_id,actor_id,revision,before_data,after_data)
  values(new.id,auth.uid(),new.revision,before_values,after_values);
 end if;
 return new;
end;
$$;
create trigger qb_project_settings_audit after update on public.qb_projects for each row execute function qb_private.audit_project_settings();
revoke all on function qb_private.version_project(),qb_private.audit_project_settings() from public,anon,authenticated;

create function public.qb_save_project_settings(p_project uuid,p_revision integer,p_title text,p_summary text,p_status text,p_target_date date)
returns integer language plpgsql security invoker set search_path='' as $$
declare project public.qb_projects%rowtype; next_revision integer;
begin
 if auth.uid() is null or not qb_private.can_view_project(p_project) or not qb_private.can_manage_project(p_project) then
  raise exception 'Project settings unavailable' using errcode='42501';
 end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 160 or p_summary is null or char_length(p_summary)>5000
 or p_status is null or p_status not in ('planned','active','paused','complete','archived') then
  raise exception 'Check the project name, outcome, and status' using errcode='22023';
 end if;
 select * into project from public.qb_projects where id=p_project for update;
 if not found then raise exception 'Project settings unavailable' using errcode='42501'; end if;
 if p_revision is null or project.revision<>p_revision then
  raise exception 'Project changed. Close settings, refresh the project, and review your changes before saving again.' using errcode='40001';
 end if;
 if (project.title,project.summary,project.status,project.target_date) is not distinct from (btrim(p_title),p_summary,p_status,p_target_date) then return project.revision; end if;
 update public.qb_projects set title=btrim(p_title),summary=p_summary,status=p_status,target_date=p_target_date
 where id=p_project returning revision into next_revision;
 if not found then raise exception 'Project settings unavailable' using errcode='42501'; end if;
 return next_revision;
end;
$$;
revoke all on function public.qb_save_project_settings(uuid,integer,text,text,text,date) from public,anon;
grant execute on function public.qb_save_project_settings(uuid,integer,text,text,text,date) to authenticated;
commit;
