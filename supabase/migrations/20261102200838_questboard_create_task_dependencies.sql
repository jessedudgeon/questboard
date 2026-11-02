-- Task and optional prerequisite commit together; existing RLS and triggers apply.
begin;
create function public.qb_create_task(
 p_project uuid, p_title text, p_description text, p_priority text,
 p_due_date date, p_assignee uuid, p_xp_reward integer, p_prerequisite uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare task_id uuid := gen_random_uuid();
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 insert into public.qb_tasks(id,project_id,title,description,priority,due_date,assignee_id,reviewer_id,xp_reward,created_by)
 values(task_id,p_project,p_title,p_description,p_priority,p_due_date,p_assignee,auth.uid(),p_xp_reward,auth.uid());
 if p_prerequisite is not null then
   perform public.qb_set_task_dependency(task_id,p_prerequisite,true);
 end if;
 return task_id;
end;
$$;
revoke all on function public.qb_create_task(uuid,text,text,text,date,uuid,integer,uuid) from public,anon;
grant execute on function public.qb_create_task(uuid,text,text,text,date,uuid,integer,uuid) to authenticated;
commit;
