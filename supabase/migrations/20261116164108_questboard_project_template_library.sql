begin;
-- A single transaction creates a complete plan. Invoker security retains existing RLS.
create function public.qb_create_project_from_template(
 p_request uuid,p_department uuid,p_title text,p_summary text,p_visibility text,p_start date,p_plan jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
 org uuid; existing public.qb_projects%rowtype; milestone jsonb; task jsonb; item jsonb;
 mid uuid; tid uuid; day_offset integer; last_offset integer:=-1; final_offset integer:=0; position integer;
begin
 if auth.uid() is null or not qb_private.is_department_manager(p_department) then
  raise exception 'Project creation unavailable for this department' using errcode='42501';
 end if;
 if p_request is null or p_start is null or p_title is null or char_length(btrim(p_title)) not between 1 and 140
 or p_summary is null or char_length(p_summary)>1200 or p_visibility is null or p_visibility not in ('department','invited','restricted')
 or p_plan is null or jsonb_typeof(p_plan)<>'array' then
  raise exception 'Invalid project template' using errcode='22023';
 end if;
 if jsonb_array_length(p_plan) not between 1 and 30 or octet_length(p_plan::text)>200000 then
  raise exception 'Template must contain 1 to 30 milestones' using errcode='22023';
 end if;
 select org_id into org from public.qb_departments where id=p_department;
 if org is null then raise exception 'Department unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-project-template:'||p_request::text,0));
 select * into existing from public.qb_projects where id=p_request;
 if found then
  if existing.created_by<>auth.uid() or existing.department_id<>p_department then
   raise exception 'Request ID already used' using errcode='22023';
  end if;
  return p_request;
 end if;
 for milestone in select value from jsonb_array_elements(p_plan) loop
  if coalesce(jsonb_typeof(milestone->'tasks'),'null')<>'array' then raise exception 'Milestone tasks required' using errcode='22023';end if;
  day_offset:=(milestone->>'offset')::integer;
  if day_offset is null or day_offset not between 0 and 3650 or day_offset<last_offset
   or jsonb_array_length(milestone->'tasks') not between 1 and 30 then
   raise exception 'Invalid milestone sequence or task count' using errcode='22023';
  end if;
  last_offset:=day_offset;final_offset:=day_offset;
 end loop;
 insert into public.qb_projects(id,org_id,department_id,title,summary,visibility,lead_id,created_by,status,target_date)
 values(p_request,org,p_department,btrim(p_title),p_summary,p_visibility,auth.uid(),auth.uid(),'planned',p_start+final_offset);
 for milestone in select value from jsonb_array_elements(p_plan) loop
  mid:=gen_random_uuid();day_offset:=(milestone->>'offset')::integer;
  insert into public.qb_milestones(id,project_id,title,description,due_date,created_by,xp_reward,coin_reward)
  values(mid,p_request,milestone->>'title',coalesce(milestone->>'description',''),p_start+day_offset,auth.uid(),0,0);
  for task in select value from jsonb_array_elements(milestone->'tasks') loop
   if task->>'title' is null or char_length(btrim(task->>'title')) not between 1 and 160
    or char_length(coalesce(task->>'description',''))>2500
    or coalesce(jsonb_typeof(task->'checklist'),'null')<>'array' then
    raise exception 'Invalid task template' using errcode='22023';
   end if;
   if jsonb_array_length(task->'checklist')>30 then raise exception 'Too many checklist items' using errcode='22023';end if;
   tid:=gen_random_uuid();
   insert into public.qb_tasks(id,project_id,milestone_id,title,description,status,priority,reviewer_id,created_by,due_date,schedule_mode,xp_reward,coin_reward)
   values(tid,p_request,mid,btrim(task->>'title'),coalesce(task->>'description',''),'backlog','normal',auth.uid(),auth.uid(),p_start+day_offset,'milestone_deadline',0,0);
   position:=0;
   for item in select value from jsonb_array_elements(task->'checklist') loop
    if jsonb_typeof(item)<>'string' or char_length(btrim(item#>>'{}')) not between 1 and 300 then
     raise exception 'Invalid checklist item' using errcode='22023';
    end if;
    insert into public.qb_checklist(task_id,title,position,done) values(tid,btrim(item#>>'{}'),position,false);
    position:=position+1;
   end loop;
  end loop;
 end loop;
 return p_request;
end;
$$;
revoke all on function public.qb_create_project_from_template(uuid,uuid,text,text,text,date,jsonb) from public,anon;
grant execute on function public.qb_create_project_from_template(uuid,uuid,text,text,text,date,jsonb) to authenticated;
commit;
