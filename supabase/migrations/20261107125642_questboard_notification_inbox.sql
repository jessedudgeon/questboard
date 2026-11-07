begin;
create table public.qb_notifications (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.qb_organizations(id),
 task_id uuid not null references public.qb_tasks(id),
 recipient_id uuid not null references auth.users(id),
 kind text not null check(kind in ('assigned','review_requested','completed','changes_requested','task_update','schedule_changed','reopened')),
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index qb_notifications_inbox on public.qb_notifications(recipient_id,org_id,created_at desc,id desc);
create index qb_notifications_unread on public.qb_notifications(recipient_id,org_id) where read_at is null;
create index qb_notifications_task on public.qb_notifications(task_id);
create index qb_notifications_org on public.qb_notifications(org_id);
alter table public.qb_notifications enable row level security;
revoke all on public.qb_notifications from public,anon,authenticated;
grant select on public.qb_notifications to authenticated;
grant update(read_at) on public.qb_notifications to authenticated;
create policy qb_notifications_read on public.qb_notifications for select to authenticated
 using(recipient_id=(select auth.uid()) and qb_private.can_view_task(task_id));
create policy qb_notifications_update on public.qb_notifications for update to authenticated
 using(recipient_id=(select auth.uid()) and qb_private.can_view_task(task_id))
 with check(recipient_id=(select auth.uid()) and qb_private.can_view_task(task_id));

-- Trigger-only elevation permits a task writer to notify another user. Rows contain
-- event kinds and task IDs; current task access is enforced when the recipient reads.
create function qb_private.notify_task_change() returns trigger language plpgsql security definer set search_path='' as $$
declare organization uuid; actor uuid:=auth.uid(); assignee_changed boolean; review_started boolean;
begin
 select org_id into organization from public.qb_projects where id=new.project_id;
 if tg_op='INSERT' then
  assignee_changed:=new.assignee_id is not null;
  review_started:=new.status='in_review';
 else
  assignee_changed:=new.assignee_id is distinct from old.assignee_id;
  review_started:=new.status='in_review' and (old.status is distinct from new.status or old.reviewer_id is distinct from new.reviewer_id);
 end if;
 if assignee_changed and new.assignee_id is not null and new.assignee_id is distinct from actor then
  insert into public.qb_notifications(org_id,task_id,recipient_id,kind) values(organization,new.id,new.assignee_id,'assigned');
 end if;
 if review_started and new.reviewer_id is not null and new.reviewer_id is distinct from actor then
  insert into public.qb_notifications(org_id,task_id,recipient_id,kind) values(organization,new.id,new.reviewer_id,'review_requested');
 end if;
 if tg_op='UPDATE' and new.assignee_id is not null and new.assignee_id is distinct from actor then
  if new.status is distinct from old.status then
   if new.status='complete' then
    insert into public.qb_notifications(org_id,task_id,recipient_id,kind) values(organization,new.id,new.assignee_id,'completed');
   elsif old.status='in_review' and new.status='in_progress' then
    insert into public.qb_notifications(org_id,task_id,recipient_id,kind) values(organization,new.id,new.assignee_id,'changes_requested');
   elsif old.status='complete' and new.status='in_progress' then
    insert into public.qb_notifications(org_id,task_id,recipient_id,kind) values(organization,new.id,new.assignee_id,'reopened');
   end if;
  end if;
  if not assignee_changed and new.due_date is distinct from old.due_date then
   insert into public.qb_notifications(org_id,task_id,recipient_id,kind) values(organization,new.id,new.assignee_id,'schedule_changed');
  end if;
 end if;
 return new;
end;
$$;
create trigger qb_task_notifications after insert or update on public.qb_tasks for each row execute function qb_private.notify_task_change();
create function qb_private.notify_task_update() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.qb_notifications(org_id,task_id,recipient_id,kind)
 select distinct p.org_id,t.id,recipient,'task_update'
 from public.qb_tasks t join public.qb_projects p on p.id=t.project_id
 cross join lateral unnest(array[t.assignee_id,t.reviewer_id]) recipient
 where t.id=new.task_id and recipient is not null and recipient is distinct from new.author_id;
 return new;
end;
$$;
create trigger qb_journal_notifications after insert on public.qb_task_updates for each row execute function qb_private.notify_task_update();
revoke all on function qb_private.notify_task_change(),qb_private.notify_task_update() from public,anon,authenticated;

create function public.qb_notification_page(p_org uuid,p_unread boolean default false,p_department uuid default null,p_query text default '',p_before timestamptz default null,p_before_id uuid default null)
returns table(id uuid,task_id uuid,kind text,created_at timestamptz,read_at timestamptz,task_title text,project_title text,project_id uuid)
language sql stable security invoker set search_path='' as $$
 select n.id,n.task_id,n.kind,n.created_at,n.read_at,t.title,p.title,p.id
 from public.qb_notifications n join public.qb_tasks t on t.id=n.task_id join public.qb_projects p on p.id=t.project_id
 where n.org_id=p_org and (not p_unread or n.read_at is null)
 and (p_department is null or p.department_id=p_department)
 and (coalesce(p_query,'')='' or strpos(lower(t.title||' '||p.title),lower(p_query))>0)
 and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id))
 order by n.created_at desc,n.id desc limit 51;
$$;
create function public.qb_notification_summary(p_org uuid)
returns table(unread_count bigint) language sql stable security invoker set search_path='' as $$
 select count(*) from public.qb_notifications where org_id=p_org and read_at is null;
$$;
create function public.qb_read_notifications(p_ids uuid[],p_read boolean)
returns integer language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_ids is null or cardinality(p_ids)>50 or p_read is null then raise exception 'Select up to 50 notifications' using errcode='22023'; end if;
 update public.qb_notifications set read_at=case when p_read then coalesce(read_at,now()) else null end
 where id=any(p_ids) and (read_at is null)=p_read;
 get diagnostics changed=row_count;
 return changed;
end;
$$;
revoke all on function public.qb_notification_page(uuid,boolean,uuid,text,timestamptz,uuid),public.qb_notification_summary(uuid),public.qb_read_notifications(uuid[],boolean) from public,anon;
grant execute on function public.qb_notification_page(uuid,boolean,uuid,text,timestamptz,uuid),public.qb_notification_summary(uuid),public.qb_read_notifications(uuid[],boolean) to authenticated;
commit;
