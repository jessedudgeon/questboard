begin;
set local lock_timeout='5s';
-- Existing task XP is preserved. No historical task or milestone payouts are created.
alter table public.qb_tasks add column coin_reward integer not null default 0 check(coin_reward between 0 and 100000);
alter table public.qb_milestones add column xp_reward integer not null default 0 check(xp_reward between 0 and 100000),add column coin_reward integer not null default 0 check(coin_reward between 0 and 100000);
alter table public.qb_task_templates add column coin_reward integer not null default 0 check(coin_reward between 0 and 100000);
create table public.qb_reward_settings(
 org_id uuid primary key references public.qb_organizations(id),
 coins_enabled boolean not null default false,xp_enabled boolean not null default true,custom_rewards boolean not null default true,
 require_review boolean not null default true,manager_recognition boolean not null default false,redemptions_enabled boolean not null default true,
 default_task_xp integer not null default 30 check(default_task_xp between 0 and 100000),default_task_coins integer not null default 0 check(default_task_coins between 0 and 100000),
 default_milestone_xp integer not null default 0 check(default_milestone_xp between 0 and 100000),default_milestone_coins integer not null default 0 check(default_milestone_coins between 0 and 100000),
 max_xp integer not null default 500 check(max_xp between 0 and 500),max_coins integer not null default 1000 check(max_coins between 0 and 100000),
 monthly_coin_budget bigint check(monthly_coin_budget>=0),max_balance bigint check(max_balance>=0),level_bonus integer not null default 0 check(level_bonus between 0 and 100000),achievement_xp integer not null default 0 check(achievement_xp between 0 and 500),achievement_bonus integer not null default 0 check(achievement_bonus between 0 and 100000),
 milestone_distribution text not null default 'split' check(milestone_distribution in ('split','each')),
 revision integer not null default 1,updated_at timestamptz not null default now(),updated_by uuid references auth.users(id),
 check(default_task_xp<=max_xp and default_milestone_xp<=max_xp and default_task_coins<=max_coins and default_milestone_coins<=max_coins and level_bonus<=max_coins and achievement_bonus<=max_coins and achievement_xp<=max_xp)
);
-- Provider-owned entitlements; organization admins cannot grant themselves a subscription.
create table public.qb_reward_entitlements(org_id uuid primary key references public.qb_organizations(id),features jsonb not null default '{"coins":true,"digital":true,"custom":true,"approvals":true,"budgets":true,"analytics":true}',updated_at timestamptz not null default now());
create table public.qb_reward_ledger(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.qb_organizations(id),user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('task','milestone','recognition','achievement','level','adjustment','reservation','settlement','release','refund','reversal')),
 coins bigint not null default 0,xp integer not null default 0 check(xp between 0 and 100000),
 source_id uuid,project_id uuid references public.qb_projects(id),reason text not null check(length(reason) between 1 and 2500),
 actor_id uuid references auth.users(id),idempotency_key text not null check(length(idempotency_key) between 1 and 200),created_at timestamptz not null default now(),
 unique(org_id,user_id,idempotency_key)
);
create index qb_reward_ledger_wallet on public.qb_reward_ledger(org_id,user_id,created_at desc);
create index qb_reward_ledger_project on public.qb_reward_ledger(project_id);
create index qb_reward_ledger_actor on public.qb_reward_ledger(actor_id);
create table public.qb_reward_catalog(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.qb_organizations(id),name text not null check(length(btrim(name)) between 1 and 120),description text not null default '' check(length(description)<=2500),
 category text not null check(category in ('digital','organization')),digital_code text check(digital_code in ('border_gold','theme_forest','title_pathfinder','celebration_stars')),
 image_url text check(image_url is null or (image_url like 'https://%' and length(image_url)<=1500)),price integer not null check(price between 0 and 1000000),
 stock integer check(stock>=0),per_user_limit integer check(per_user_limit>0),period_limit integer check(period_limit>0),period text not null default 'month' check(period in ('month','quarter')),
 min_level integer not null default 1 check(min_level between 1 and 20),eligible_role text not null default 'any' check(eligible_role in ('any','member','admin')),
 active boolean not null default true,archived boolean not null default false,featured boolean not null default false,approval_required boolean not null default true,
 instructions text not null default '' check(length(instructions)<=2500),available_from date,available_until date,request_days integer not null default 30 check(request_days between 1 and 365),
 revision integer not null default 1,created_by uuid references auth.users(id),created_at timestamptz not null default now(),
 unique(id,org_id),check(available_from is null or available_until is null or available_from<=available_until),check((category='digital')=(digital_code is not null))
);
create index qb_reward_catalog_org on public.qb_reward_catalog(org_id);
create table public.qb_reward_redemptions(
 id uuid primary key,org_id uuid not null references public.qb_organizations(id),user_id uuid not null references auth.users(id),item_id uuid not null,
 item_name text not null,price integer not null check(price>=0),digital_code text,approval_required boolean not null,instructions text not null default '',
 status text not null check(status in ('requested','approved','fulfilled','rejected','canceled','expired','refunded')),
 requested_at timestamptz not null default now(),expires_at timestamptz not null,approved_by uuid references auth.users(id),fulfilled_by uuid references auth.users(id),updated_at timestamptz not null default now(),notes text not null default '',
 foreign key(item_id,org_id) references public.qb_reward_catalog(id,org_id)
);
create index qb_redemptions_org_status on public.qb_reward_redemptions(org_id,status);
create index qb_redemptions_user on public.qb_reward_redemptions(user_id);
create index qb_redemptions_item on public.qb_reward_redemptions(item_id);
create table public.qb_reward_unlocks(org_id uuid not null references public.qb_organizations(id),user_id uuid not null references auth.users(id),digital_code text not null,redemption_id uuid not null references public.qb_reward_redemptions(id),equipped boolean not null default false,created_at timestamptz not null default now(),primary key(org_id,user_id,digital_code));
create table public.qb_reward_awards(org_id uuid not null references public.qb_organizations(id),kind text not null check(kind in ('task','milestone')),source_id uuid not null,created_at timestamptz not null default now(),primary key(kind,source_id));
create table public.qb_reward_audit(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.qb_organizations(id),actor_id uuid references auth.users(id),action text not null,source_id uuid,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
create index qb_reward_audit_org on public.qb_reward_audit(org_id,created_at desc);
-- All mutation goes through checked transactions. Ledger has no client mutation grants.
do $$ declare t text;begin foreach t in array array['qb_reward_settings','qb_reward_entitlements','qb_reward_ledger','qb_reward_catalog','qb_reward_redemptions','qb_reward_unlocks','qb_reward_awards','qb_reward_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;end $$;
create policy qb_reward_settings_read on public.qb_reward_settings for select to authenticated using(qb_private.is_org_member(org_id));
create policy qb_reward_entitlements_read on public.qb_reward_entitlements for select to authenticated using(qb_private.is_org_member(org_id));
create policy qb_reward_catalog_read on public.qb_reward_catalog for select to authenticated using(qb_private.is_org_member(org_id));
create policy qb_reward_ledger_read on public.qb_reward_ledger for select to authenticated using(qb_private.is_org_member(org_id) and (user_id=(select auth.uid()) or qb_private.is_org_admin(org_id)));
create policy qb_reward_redemptions_read on public.qb_reward_redemptions for select to authenticated using(qb_private.is_org_member(org_id) and (user_id=(select auth.uid()) or qb_private.is_org_admin(org_id)));
create policy qb_reward_unlocks_read on public.qb_reward_unlocks for select to authenticated using(qb_private.is_org_member(org_id) and user_id=(select auth.uid()));
create policy qb_reward_awards_read on public.qb_reward_awards for select to authenticated using(qb_private.is_org_admin(org_id));
create policy qb_reward_audit_read on public.qb_reward_audit for select to authenticated using(qb_private.is_org_admin(org_id));
create function qb_private.reward_lock(p_org uuid) returns public.qb_reward_settings language plpgsql security definer set search_path='' as $$
declare cfg public.qb_reward_settings;begin
 if auth.uid() is null or not qb_private.is_org_member(p_org) then raise exception 'Organization unavailable' using errcode='42501';end if;
 insert into public.qb_reward_settings(org_id) values(p_org) on conflict do nothing;
 select * into cfg from public.qb_reward_settings where org_id=p_org for update;return cfg;
end $$;
create function qb_private.reward_feature(p_org uuid,p_feature text) returns boolean language sql stable security definer set search_path='' as $$select coalesce((select (features->>p_feature)::boolean from public.qb_reward_entitlements where org_id=p_org),true)$$;
create function qb_private.reward_xp(p_org uuid,p_user uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select sum(x.amount) from public.qb_xp_events x join public.qb_tasks t on t.id=x.task_id join public.qb_projects p on p.id=t.project_id where p.org_id=p_org and x.user_id=p_user),0)+coalesce((select sum(xp) from public.qb_reward_ledger where org_id=p_org and user_id=p_user),0)
$$;
create function qb_private.reward_balance(p_org uuid,p_user uuid) returns bigint language sql stable security definer set search_path='' as $$select coalesce(sum(coins),0) from public.qb_reward_ledger where org_id=p_org and user_id=p_user$$;
create function qb_private.reward_post(p_org uuid,p_user uuid,p_kind text,p_coins bigint,p_xp integer,p_source uuid,p_project uuid,p_reason text,p_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare cfg public.qb_reward_settings;balance bigint;issued bigint;begin
 cfg:=qb_private.reward_lock(p_org);
 if exists(select 1 from public.qb_reward_ledger where org_id=p_org and user_id=p_user and idempotency_key=p_key) then return false;end if;
 if p_kind not in ('release','refund','settlement','reversal') and not exists(select 1 from public.qb_org_members where org_id=p_org and user_id=p_user and status='active') then raise exception 'Recipient must be an active organization member' using errcode='42501';end if;
 balance:=qb_private.reward_balance(p_org,p_user);
 if balance+p_coins<0 then raise exception 'Insufficient coin balance' using errcode='23514';end if;
 if p_coins>0 and p_kind not in ('release','refund','reversal') then
  if not cfg.coins_enabled or not qb_private.reward_feature(p_org,'coins') then raise exception 'Coins are disabled';end if;
  if cfg.max_balance is not null and balance+p_coins+coalesce((select sum(price) from public.qb_reward_redemptions where org_id=p_org and user_id=p_user and status in ('requested','approved')),0)>cfg.max_balance then raise exception 'Maximum wallet balance would be exceeded';end if;
  select coalesce(sum(coins),0) into issued from public.qb_reward_ledger where org_id=p_org and coins>0 and kind not in ('release','refund','reversal') and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  if cfg.monthly_coin_budget is not null and issued+p_coins>cfg.monthly_coin_budget then raise exception 'Monthly coin issuance budget would be exceeded';end if;
 end if;
 insert into public.qb_reward_ledger(org_id,user_id,kind,coins,xp,source_id,project_id,reason,actor_id,idempotency_key) values(p_org,p_user,p_kind,p_coins,p_xp,p_source,p_project,p_reason,auth.uid(),p_key);return true;
end $$;
create function qb_private.reward_level_bonus(p_org uuid,p_user uuid,p_before bigint) returns void language plpgsql security definer set search_path='' as $$
declare cfg public.qb_reward_settings;l integer;after_level integer;begin
 cfg:=qb_private.reward_lock(p_org);if not cfg.coins_enabled or cfg.level_bonus=0 then return;end if;
 after_level:=least(20,1+floor(sqrt(qb_private.reward_xp(p_org,p_user)/65.0))::integer);
 for l in (least(20,1+floor(sqrt(p_before/65.0))::integer)+1)..after_level loop
 perform qb_private.reward_post(p_org,p_user,'level',cfg.level_bonus,0,null,null,'Reached level '||l,'level:'||l);end loop;
end $$;
create function public.qb_save_reward_settings(p_org uuid,p_values jsonb,p_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare oldrow public.qb_reward_settings;newrow public.qb_reward_settings;k text;begin
 oldrow:=qb_private.reward_lock(p_org);if not qb_private.is_org_admin(p_org) then raise exception 'Administrator required' using errcode='42501';end if;
 if p_revision is null or oldrow.revision<>p_revision then raise exception 'Settings changed. Reload before saving.' using errcode='40001';end if;
 for k in select jsonb_object_keys(p_values) loop if k not in ('coins_enabled','xp_enabled','custom_rewards','require_review','manager_recognition','redemptions_enabled','default_task_xp','default_task_coins','default_milestone_xp','default_milestone_coins','max_xp','max_coins','monthly_coin_budget','max_balance','level_bonus','achievement_bonus','achievement_xp','milestone_distribution') then raise exception 'Unknown policy field';end if;end loop;
 newrow:=jsonb_populate_record(oldrow,p_values);if (newrow.monthly_coin_budget is not null or newrow.max_balance is not null) and not qb_private.reward_feature(p_org,'budgets') then raise exception 'Budget controls unavailable';end if;if newrow.coins_enabled and not qb_private.reward_feature(p_org,'coins') then raise exception 'Coins not included in organization entitlement';end if;
 update public.qb_reward_settings set coins_enabled=newrow.coins_enabled,xp_enabled=newrow.xp_enabled,custom_rewards=newrow.custom_rewards,require_review=newrow.require_review,manager_recognition=newrow.manager_recognition,redemptions_enabled=newrow.redemptions_enabled,default_task_xp=newrow.default_task_xp,default_task_coins=newrow.default_task_coins,default_milestone_xp=newrow.default_milestone_xp,default_milestone_coins=newrow.default_milestone_coins,max_xp=newrow.max_xp,max_coins=newrow.max_coins,monthly_coin_budget=newrow.monthly_coin_budget,max_balance=newrow.max_balance,level_bonus=newrow.level_bonus,achievement_bonus=newrow.achievement_bonus,achievement_xp=newrow.achievement_xp,milestone_distribution=newrow.milestone_distribution,revision=revision+1,updated_at=now(),updated_by=auth.uid() where org_id=p_org;
 insert into public.qb_reward_audit(org_id,actor_id,action,before_data,after_data) values(p_org,auth.uid(),'settings',to_jsonb(oldrow),to_jsonb(newrow));
end $$;
create function public.qb_set_work_rewards(p_kind text,p_ids uuid[],p_xp integer,p_coins integer) returns void language plpgsql security definer set search_path='' as $$
declare i uuid;project uuid;org uuid;cfg public.qb_reward_settings;before_row jsonb;begin
 if p_kind not in ('task','milestone') or coalesce(cardinality(p_ids),0) not between 1 and 100 or p_xp is null or p_coins is null or p_xp<0 or p_coins<0 then raise exception 'Invalid reward configuration';end if;
 -- Lock projects in a deterministic order, matching the task workflow lock order.
 for project in select distinct p.id from public.qb_projects p where p.id in(select project_id from public.qb_tasks where p_kind='task' and id=any(p_ids) union select project_id from public.qb_milestones where p_kind='milestone' and id=any(p_ids)) order by p.id loop perform qb_private.lock_dependency_project(project);end loop;
 foreach i in array p_ids loop
  if p_kind='task' then select project_id,to_jsonb(t) into project,before_row from public.qb_tasks t where id=i for update;else select project_id,to_jsonb(m) into project,before_row from public.qb_milestones m where id=i for update;end if;
  if project is null or not qb_private.can_manage_project(project) or (p_kind='task' and not qb_private.can_view_task(i)) then raise exception 'Work unavailable' using errcode='42501';end if;
  select org_id into org from public.qb_projects where id=project;cfg:=qb_private.reward_lock(org);
  if p_xp>cfg.max_xp or p_coins>cfg.max_coins or (p_coins>0 and (not cfg.coins_enabled or not qb_private.reward_feature(org,'coins'))) or (p_xp>0 and not cfg.xp_enabled) then raise exception 'Rewards exceed or conflict with organization policy';end if;
  if exists(select 1 from public.qb_reward_awards where kind=p_kind and source_id=i) or (p_kind='task' and (before_row->>'status'='complete' or exists(select 1 from public.qb_xp_events where task_id=i))) then raise exception 'Rewards are locked after completion';end if;
  if p_kind='task' then update public.qb_tasks set xp_reward=p_xp,coin_reward=p_coins where id=i;else update public.qb_milestones set xp_reward=p_xp,coin_reward=p_coins where id=i;end if;
  insert into public.qb_reward_audit(org_id,actor_id,action,source_id,before_data,after_data) values(org,auth.uid(),'configure_'||p_kind,i,before_row,jsonb_build_object('xp',p_xp,'coins',p_coins));
 end loop;
end $$;
-- Prevent direct API writes bypassing limits, including inserts through existing task APIs.
create function qb_private.guard_reward_config() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;cfg public.qb_reward_settings;begin
 select org_id into org from public.qb_projects where id=new.project_id;
 select * into cfg from public.qb_reward_settings where org_id=org;
 if found and (new.xp_reward>cfg.max_xp or new.coin_reward>cfg.max_coins or (new.coin_reward>0 and not cfg.coins_enabled)) then raise exception 'Reward exceeds organization maximum';end if;
 if tg_op='UPDATE' and (new.xp_reward is distinct from old.xp_reward or new.coin_reward is distinct from old.coin_reward) then
  if tg_table_name='qb_tasks' then if old.status='complete' or exists(select 1 from public.qb_xp_events where task_id=old.id) then raise exception 'Rewards are locked after completion';end if;end if;
  if exists(select 1 from public.qb_reward_awards where source_id=old.id) then raise exception 'Rewards already awarded';end if;
 end if;return new;
end $$;
grant update(coin_reward) on public.qb_tasks to authenticated;
create trigger qb_task_rewards_guard before insert or update of xp_reward,coin_reward on public.qb_tasks for each row execute function qb_private.guard_reward_config();
create trigger qb_milestone_rewards_guard before insert or update of xp_reward,coin_reward on public.qb_milestones for each row execute function qb_private.guard_reward_config();
create function qb_private.grant_task_rewards(p_task uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.qb_tasks;org uuid;cfg public.qb_reward_settings;before_xp bigint;reward_xp integer;reward_coins integer;awards integer;mark integer;begin
 select * into t from public.qb_tasks where id=p_task for update;select org_id into org from public.qb_projects where id=t.project_id;
 if t.status<>'complete' or t.assignee_id is null then return;end if;
 cfg:=qb_private.reward_lock(org);
 if exists(select 1 from public.qb_xp_events where task_id=t.id) then return;end if;
 insert into public.qb_reward_awards(org_id,kind,source_id) values(org,'task',t.id) on conflict do nothing;get diagnostics mark=row_count;if mark=0 then return;end if;
 before_xp:=qb_private.reward_xp(org,t.assignee_id);reward_xp:=case when cfg.xp_enabled then least(t.xp_reward,cfg.max_xp) else 0 end;reward_coins:=case when cfg.coins_enabled then least(t.coin_reward,cfg.max_coins) else 0 end;
 if reward_xp>0 then insert into public.qb_xp_events(task_id,user_id,amount) values(t.id,t.assignee_id,reward_xp) on conflict(task_id) do nothing;end if;
 perform qb_private.reward_post(org,t.assignee_id,'task',reward_coins,0,t.id,t.project_id,'Task approved','task:'||t.id);
 perform qb_private.reward_level_bonus(org,t.assignee_id,before_xp);
 select count(*) into awards from public.qb_reward_ledger where org_id=org and user_id=t.assignee_id and kind='task';
 if awards in (1,10,50) then before_xp:=qb_private.reward_xp(org,t.assignee_id);perform qb_private.reward_post(org,t.assignee_id,'achievement',case when cfg.coins_enabled then cfg.achievement_bonus else 0 end,case when cfg.xp_enabled then cfg.achievement_xp else 0 end,null,null,'Achievement: '||awards||' rewarded tasks','achievement:tasks:'||awards);perform qb_private.reward_level_bonus(org,t.assignee_id,before_xp);end if;
end $$;
create function public.qb_claim_milestone_rewards(p_milestone uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.qb_milestones;org uuid;cfg public.qb_reward_settings;r record;n integer;i integer:=0;xp integer;coins integer;before_xp bigint;mark integer;begin
 select * into m from public.qb_milestones where id=p_milestone;
 if not found or not qb_private.can_manage_project(m.project_id) then raise exception 'Project lead required' using errcode='42501';end if;
 perform qb_private.lock_dependency_project(m.project_id);select * into m from public.qb_milestones where id=p_milestone for update;
 select org_id into org from public.qb_projects where id=m.project_id;cfg:=qb_private.reward_lock(org);
 if m.archived or not exists(select 1 from public.qb_tasks where milestone_id=m.id and status<>'cancelled') or exists(select 1 from public.qb_tasks where milestone_id=m.id and status not in ('complete','cancelled')) then raise exception 'All milestone tasks must be approved first';end if;
 if m.created_at < (select installed_at from qb_private.reward_installation limit 1) and not exists(select 1 from public.qb_reward_audit where source_id=m.id and action='configure_milestone') then raise exception 'Configure a milestone reward explicitly before awarding historical milestones';end if;
 if exists(select 1 from public.qb_tasks where milestone_id=m.id and status='complete' and assignee_id is null) then raise exception 'Assign every completed task to an active recipient before awarding the milestone';end if;
 select count(distinct assignee_id) into n from public.qb_tasks where milestone_id=m.id and status='complete';if n=0 then raise exception 'No recipients';end if;
 insert into public.qb_reward_awards(org_id,kind,source_id) values(org,'milestone',m.id) on conflict do nothing;get diagnostics mark=row_count;if mark=0 then return;end if;
 for r in select distinct assignee_id as user_id from public.qb_tasks where milestone_id=m.id and status='complete' order by assignee_id loop
  i:=i+1;before_xp:=qb_private.reward_xp(org,r.user_id);
  xp:=case when cfg.xp_enabled then least(m.xp_reward,cfg.max_xp) else 0 end;coins:=case when cfg.coins_enabled then least(m.coin_reward,cfg.max_coins) else 0 end;
  if cfg.milestone_distribution='split' then xp:=xp/n+case when i<=xp%n then 1 else 0 end;coins:=coins/n+case when i<=coins%n then 1 else 0 end;end if;
  perform qb_private.reward_post(org,r.user_id,'milestone',coins,xp,m.id,m.project_id,'Milestone completion bonus','milestone:'||m.id);
  perform qb_private.reward_level_bonus(org,r.user_id,before_xp);
 end loop;
end $$;
create table qb_private.reward_installation(installed_at timestamptz not null default now());insert into qb_private.reward_installation default values;
create function public.qb_recognize(p_org uuid,p_user uuid,p_request uuid,p_xp integer,p_coins integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare cfg public.qb_reward_settings;before_xp bigint;begin
 cfg:=qb_private.reward_lock(p_org);
 if not qb_private.is_org_admin(p_org) and not(cfg.manager_recognition and exists(select 1 from public.qb_projects p where p.org_id=p_org and qb_private.can_manage_project(p.id) and exists(select 1 from public.qb_assignment_candidates(p.id) a where a.user_id=p_user))) then raise exception 'Recognition permission required' using errcode='42501';end if;
 if p_request is null or coalesce(length(btrim(p_reason)),0) not between 1 and 2500 or p_xp is null or p_coins is null or p_xp<0 or p_coins<0 or p_xp+p_coins=0 or p_xp>cfg.max_xp or p_coins>cfg.max_coins or (p_xp>0 and not cfg.xp_enabled) then raise exception 'Invalid recognition amount or reason';end if;
 before_xp:=qb_private.reward_xp(p_org,p_user);
 if qb_private.reward_post(p_org,p_user,'recognition',p_coins,p_xp,p_request,null,p_reason,'recognition:'||p_request) then perform qb_private.reward_level_bonus(p_org,p_user,before_xp);end if;
end $$;
create function public.qb_adjust_coins(p_org uuid,p_user uuid,p_request uuid,p_coins integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform qb_private.reward_lock(p_org);if not qb_private.is_org_admin(p_org) then raise exception 'Administrator required' using errcode='42501';end if;
 if p_request is null or p_coins is null or p_coins=0 or abs(p_coins::bigint)>100000 or coalesce(length(btrim(p_reason)),0) not between 1 and 2500 then raise exception 'Enter a bounded adjustment and reason';end if;
 perform qb_private.reward_post(p_org,p_user,'adjustment',p_coins,0,p_request,null,p_reason,'adjustment:'||p_request);
end $$;
create function public.qb_save_reward_item(p_org uuid,p_id uuid,p_values jsonb,p_revision integer default null) returns uuid language plpgsql security definer set search_path='' as $$
declare cfg public.qb_reward_settings;oldrow public.qb_reward_catalog;item public.qb_reward_catalog;k text;begin
 cfg:=qb_private.reward_lock(p_org);if not qb_private.is_org_admin(p_org) then raise exception 'Administrator required' using errcode='42501';end if;
 if p_id is null then raise exception 'Request ID required';end if;
 select * into oldrow from public.qb_reward_catalog where id=p_id for update;
 if found then
  if oldrow.org_id<>p_org then raise exception 'Reward unavailable' using errcode='42501';end if;
  if p_revision is null then return p_id;end if;
  if p_revision is null or oldrow.revision<>p_revision then raise exception 'Reward changed. Reload before saving.' using errcode='40001';end if;
 else
  if p_revision is not null then raise exception 'Reward unavailable';end if;
  oldrow:=jsonb_populate_record(null::public.qb_reward_catalog,'{"description":"","category":"organization","price":0,"period":"month","min_level":1,"eligible_role":"any","active":true,"archived":false,"featured":false,"approval_required":true,"instructions":"","request_days":30,"revision":1}');
 end if;
 for k in select jsonb_object_keys(p_values) loop if k not in ('name','description','category','digital_code','image_url','price','stock','per_user_limit','period_limit','period','min_level','eligible_role','active','archived','featured','approval_required','instructions','available_from','available_until','request_days') then raise exception 'Unknown reward field';end if;end loop;
 item:=jsonb_populate_record(oldrow,p_values);
 if item.category='organization' and (not cfg.custom_rewards or not qb_private.reward_feature(p_org,'custom')) then raise exception 'Custom rewards are disabled';end if;
 if item.approval_required and not qb_private.reward_feature(p_org,'approvals') then raise exception 'Approval workflows unavailable';end if;
 if item.category='digital' and not qb_private.reward_feature(p_org,'digital') then raise exception 'Digital rewards unavailable';end if;
 if oldrow.id is not null and (item.digital_code is distinct from oldrow.digital_code or item.category<>oldrow.category) and exists(select 1 from public.qb_reward_redemptions where item_id=p_id) then raise exception 'Purchased reward type cannot be changed';end if;
 insert into public.qb_reward_catalog(id,org_id,name,description,category,digital_code,image_url,price,stock,per_user_limit,period_limit,period,min_level,eligible_role,active,archived,featured,approval_required,instructions,available_from,available_until,request_days,created_by)
 values(p_id,p_org,item.name,item.description,item.category,item.digital_code,item.image_url,item.price,item.stock,item.per_user_limit,item.period_limit,item.period,item.min_level,item.eligible_role,item.active,item.archived,item.featured,item.approval_required,item.instructions,item.available_from,item.available_until,item.request_days,auth.uid())
 on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,digital_code=excluded.digital_code,image_url=excluded.image_url,price=excluded.price,stock=excluded.stock,per_user_limit=excluded.per_user_limit,period_limit=excluded.period_limit,period=excluded.period,min_level=excluded.min_level,eligible_role=excluded.eligible_role,active=excluded.active,archived=excluded.archived,featured=excluded.featured,approval_required=excluded.approval_required,instructions=excluded.instructions,available_from=excluded.available_from,available_until=excluded.available_until,request_days=excluded.request_days,revision=public.qb_reward_catalog.revision+1;
 insert into public.qb_reward_audit(org_id,actor_id,action,source_id,before_data,after_data) values(p_org,auth.uid(),'catalog',p_id,to_jsonb(oldrow),to_jsonb(item));return p_id;
end $$;
create function qb_private.reward_release(p_id uuid,p_status text,p_notes text) returns void language plpgsql security definer set search_path='' as $$
declare r public.qb_reward_redemptions;begin
 select * into r from public.qb_reward_redemptions where id=p_id for update;
 if r.status not in ('requested','approved') then return;end if;
 perform qb_private.reward_post(r.org_id,r.user_id,'release',r.price,0,r.id,null,p_status||': '||r.item_name,'release:'||r.id);
 update public.qb_reward_catalog set stock=stock+1 where id=r.item_id and stock is not null;
 update public.qb_reward_redemptions set status=p_status,notes=p_notes,updated_at=now() where id=r.id;
 insert into public.qb_reward_audit(org_id,actor_id,action,source_id,after_data) values(r.org_id,auth.uid(),p_status,r.id,jsonb_build_object('notes',p_notes));
end $$;
create function qb_private.expire_rewards(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
declare r record;begin
 for r in select id from public.qb_reward_redemptions where org_id=p_org and status in ('requested','approved') and expires_at<=now() order by id loop perform qb_private.reward_release(r.id,'expired','Reservation expired');end loop;
end $$;
create function public.qb_redeem_reward(p_org uuid,p_item uuid,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare cfg public.qb_reward_settings;item public.qb_reward_catalog;r public.qb_reward_redemptions;level integer;member_role text;used integer;state text;begin
 cfg:=qb_private.reward_lock(p_org);perform qb_private.expire_rewards(p_org);
 if p_request is null then raise exception 'Request ID required';end if;
 select * into r from public.qb_reward_redemptions where id=p_request;
 if found then if r.org_id<>p_org or r.user_id<>auth.uid() or r.item_id<>p_item then raise exception 'Request ID already used' using errcode='42501';end if;return r.id;end if;
 if not cfg.coins_enabled or not cfg.redemptions_enabled or not qb_private.reward_feature(p_org,'coins') then raise exception 'Redemptions are disabled';end if;
 select * into item from public.qb_reward_catalog where id=p_item and org_id=p_org for update;
 if not found or not item.active or item.archived or (item.available_from is not null and item.available_from>current_date) or (item.available_until is not null and item.available_until<current_date) then raise exception 'Reward is not available';end if;
 if item.category='organization' and (not cfg.custom_rewards or not qb_private.reward_feature(p_org,'custom')) then raise exception 'Custom rewards disabled';end if;
 if item.approval_required and not qb_private.reward_feature(p_org,'approvals') then raise exception 'Approval workflows unavailable';end if;
 if item.category='digital' and not qb_private.reward_feature(p_org,'digital') then raise exception 'Digital rewards unavailable';end if;
 select role into member_role from public.qb_org_members where org_id=p_org and user_id=auth.uid() and status='active';
 level:=least(20,1+floor(sqrt(qb_private.reward_xp(p_org,auth.uid())/65.0))::integer);
 if level<item.min_level or (item.eligible_role<>'any' and member_role<>item.eligible_role) then raise exception 'Not eligible for this reward';end if;
 if item.stock is not null and item.stock<1 then raise exception 'Reward is out of stock';end if;
 if item.digital_code is not null and (exists(select 1 from public.qb_reward_unlocks where org_id=p_org and user_id=auth.uid() and digital_code=item.digital_code) or exists(select 1 from public.qb_reward_redemptions where org_id=p_org and user_id=auth.uid() and digital_code=item.digital_code and status in ('requested','approved'))) then raise exception 'Digital reward already owned or requested';end if;
 select count(*) into used from public.qb_reward_redemptions where item_id=p_item and user_id=auth.uid() and status in ('requested','approved','fulfilled');
 if item.per_user_limit is not null and used>=item.per_user_limit then raise exception 'Personal redemption limit reached';end if;
 select count(*) into used from public.qb_reward_redemptions where item_id=p_item and status in ('requested','approved','fulfilled') and requested_at>=date_trunc(item.period,now() at time zone 'UTC') at time zone 'UTC';
 if item.period_limit is not null and used>=item.period_limit then raise exception 'Period redemption limit reached';end if;
 perform qb_private.reward_post(p_org,auth.uid(),'reservation',-item.price,0,p_request,null,'Reserved: '||item.name,'reserve:'||p_request);
 state:=case when item.approval_required then 'requested' when item.digital_code is not null then 'fulfilled' else 'approved' end;
 insert into public.qb_reward_redemptions(id,org_id,user_id,item_id,item_name,price,digital_code,approval_required,instructions,status,expires_at) values(p_request,p_org,auth.uid(),p_item,item.name,item.price,item.digital_code,item.approval_required,item.instructions,state,now()+make_interval(days=>item.request_days));
 update public.qb_reward_catalog set stock=stock-1 where id=p_item and stock is not null;
 if state='fulfilled' then
  insert into public.qb_reward_unlocks(org_id,user_id,digital_code,redemption_id) values(p_org,auth.uid(),item.digital_code,p_request) on conflict do nothing;
  perform qb_private.reward_post(p_org,auth.uid(),'settlement',0,0,p_request,null,'Fulfilled: '||item.name,'settle:'||p_request);
 end if;
 insert into public.qb_reward_audit(org_id,actor_id,action,source_id,after_data) values(p_org,auth.uid(),'redeem',p_request,jsonb_build_object('status',state,'price',item.price));return p_request;
end $$;
create function public.qb_manage_redemption(p_org uuid,p_id uuid,p_action text,p_notes text default '') returns void language plpgsql security definer set search_path='' as $$
declare r public.qb_reward_redemptions;admin boolean;begin
 perform qb_private.reward_lock(p_org);perform qb_private.expire_rewards(p_org);admin:=qb_private.is_org_admin(p_org);
 select * into r from public.qb_reward_redemptions where id=p_id and org_id=p_org for update;
 if not found or (not admin and (r.user_id<>auth.uid() or p_action<>'cancel')) then raise exception 'Redemption unavailable' using errcode='42501';end if;
 if length(p_notes)>2500 then raise exception 'Notes too long';end if;
 if (p_action='approve' and r.status in ('approved','fulfilled')) or (p_action='fulfill' and r.status='fulfilled') or (p_action='cancel' and r.status='canceled') or (p_action='reject' and r.status='rejected') or (p_action='refund' and r.status='refunded') then return;end if;
 if p_action in ('cancel','reject') and r.status in ('requested','approved') then perform qb_private.reward_release(r.id,case when p_action='cancel' then 'canceled' else 'rejected' end,p_notes);return;end if;
 if p_action='approve' and r.status='requested' then
  update public.qb_reward_redemptions set status='approved',approved_by=auth.uid(),notes=p_notes,updated_at=now() where id=r.id;
  if r.digital_code is null then return;end if;
 elsif p_action='refund' and r.status='fulfilled' and r.digital_code is null then
  if coalesce(length(btrim(p_notes)),0)=0 then raise exception 'Refund reason required';end if;
  perform qb_private.reward_post(p_org,r.user_id,'refund',r.price,0,r.id,null,p_notes,'refund:'||r.id);
  update public.qb_reward_redemptions set status='refunded',notes=p_notes,updated_at=now() where id=r.id;return;
 elsif not(p_action='fulfill' and r.status='approved') then raise exception 'Invalid redemption transition';end if;
 update public.qb_reward_redemptions set status='fulfilled',fulfilled_by=auth.uid(),notes=p_notes,updated_at=now() where id=r.id;
 if r.digital_code is not null then insert into public.qb_reward_unlocks(org_id,user_id,digital_code,redemption_id) values(p_org,r.user_id,r.digital_code,r.id) on conflict do nothing;end if;
 perform qb_private.reward_post(p_org,r.user_id,'settlement',0,0,r.id,null,'Fulfilled: '||r.item_name,'settle:'||r.id);
 insert into public.qb_reward_audit(org_id,actor_id,action,source_id,after_data) values(p_org,auth.uid(),p_action,r.id,jsonb_build_object('notes',p_notes));
end $$;
create function public.qb_equip_reward(p_org uuid,p_code text,p_equipped boolean) returns void language plpgsql security definer set search_path='' as $$begin
 perform qb_private.reward_lock(p_org);update public.qb_reward_unlocks set equipped=p_equipped where org_id=p_org and user_id=auth.uid() and digital_code=p_code;if not found then raise exception 'Digital reward not owned';end if;end $$;
create function public.qb_rewards_summary(p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.qb_reward_settings;admin boolean;result jsonb;begin
 cfg:=qb_private.reward_lock(p_org);perform qb_private.expire_rewards(p_org);admin:=qb_private.is_org_admin(p_org);
 result:=jsonb_build_object('settings',to_jsonb(cfg),'balance',qb_private.reward_balance(p_org,auth.uid()),'xp_total',qb_private.reward_xp(p_org,auth.uid()),'admin',admin,
 'reserved',coalesce((select sum(price) from public.qb_reward_redemptions where org_id=p_org and user_id=auth.uid() and status in ('requested','approved')),0),
 'entitlements',coalesce((select features from public.qb_reward_entitlements where org_id=p_org),'{"coins":true,"digital":true,"custom":true,"approvals":true,"budgets":true,"analytics":true}'::jsonb),
 'unlocks',coalesce((select jsonb_agg(to_jsonb(u)) from public.qb_reward_unlocks u where org_id=p_org and user_id=auth.uid()),'[]'::jsonb),
 'availability',coalesce((select jsonb_object_agg(c.id,(select count(*) from public.qb_reward_redemptions r where r.item_id=c.id and r.status in ('requested','approved','fulfilled') and r.requested_at>=date_trunc(c.period,now() at time zone 'UTC') at time zone 'UTC')) from public.qb_reward_catalog c where c.org_id=p_org),'{}'::jsonb),
 'pending',case when admin then (select count(*) from public.qb_reward_redemptions where org_id=p_org and status='requested') else 0 end);
 if admin then result:=result||jsonb_build_object('metrics',jsonb_build_object(
 'issued',coalesce((select sum(coins) from public.qb_reward_ledger where org_id=p_org and coins>0 and kind not in ('release','refund','reversal')),0),
 'spent',coalesce((select sum(price) from public.qb_reward_redemptions where org_id=p_org and status='fulfilled'),0),
 'outstanding',coalesce((select sum(coins) from public.qb_reward_ledger where org_id=p_org),0),
 'reserved',coalesce((select sum(price) from public.qb_reward_redemptions where org_id=p_org and status in ('requested','approved')),0),
 'awaiting_fulfillment',(select count(*) from public.qb_reward_redemptions where org_id=p_org and status='approved'),
 'active_catalog',(select count(*) from public.qb_reward_catalog where org_id=p_org and active and not archived),
 'monthly_issued',coalesce((select sum(coins) from public.qb_reward_ledger where org_id=p_org and coins>0 and kind not in ('release','refund','reversal') and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0)));end if;
 return result;
end $$;

create or replace function public.qb_transition_task(p_task uuid,p_new_status text) returns void language plpgsql security definer set search_path = '' as $$
declare t public.qb_tasks%rowtype; manager_allowed boolean; actor uuid := (select auth.uid());
begin
  if p_new_status is null then raise exception 'Status is required'; end if;
  if actor is null then raise exception 'Sign in required'; end if;
  select * into t from public.qb_tasks where id=p_task;
  if not found or not qb_private.can_view_task(p_task) then raise exception 'Task unavailable'; end if;
  perform qb_private.lock_dependency_project(t.project_id);
  select * into t from public.qb_tasks where id=p_task for update;
  if not found or not qb_private.can_view_task(p_task) then raise exception 'Task unavailable'; end if;
  manager_allowed := qb_private.can_manage_project(t.project_id);
  if not (manager_allowed or coalesce(t.assignee_id=actor,false) or coalesce(t.reviewer_id=actor,false)) then raise exception 'Not assigned to this task'; end if;
  if not (
    (t.status='backlog' and p_new_status='ready' and manager_allowed) or
    (t.status='ready' and p_new_status='in_progress' and (manager_allowed or coalesce(t.assignee_id=actor,false))) or
    (t.status='in_progress' and p_new_status in ('blocked','in_review') and (manager_allowed or coalesce(t.assignee_id=actor,false))) or
    (t.status='blocked' and p_new_status='in_progress' and (manager_allowed or coalesce(t.assignee_id=actor,false))) or
    (t.status='in_review' and p_new_status='in_progress' and (manager_allowed or coalesce(t.reviewer_id=actor,false))) or
    (t.status='in_progress' and p_new_status='complete' and not coalesce((select require_review from public.qb_reward_settings where org_id=(select org_id from public.qb_projects where id=t.project_id)),true) and (manager_allowed or coalesce(t.assignee_id=actor,false))) or
    (t.status='in_review' and p_new_status='complete' and (manager_allowed or coalesce(t.reviewer_id=actor,false)) and (manager_allowed or actor<>coalesce(t.assignee_id,'00000000-0000-0000-0000-000000000000'::uuid))) or
    (t.status='complete' and p_new_status='in_progress' and manager_allowed)
  ) then raise exception 'Invalid or unauthorized status change'; end if;
  if p_new_status in ('in_review','complete') and exists(select 1 from public.qb_checklist c where c.task_id=t.id and not c.done) then raise exception 'Finish the checklist first'; end if;
  update public.qb_tasks set status=p_new_status,updated_at=now(),completed_at=case when p_new_status='complete' then now() else null end where id=p_task;
  insert into public.qb_task_events(task_id,actor_id,event_type,before_data,after_data) values(p_task,actor,'status',jsonb_build_object('status',t.status),jsonb_build_object('status',p_new_status));
  if p_new_status='complete' then perform qb_private.grant_task_rewards(t.id);end if;
end;
$$;

create or replace function public.qb_create_planned_task(p_request uuid,p_project uuid,p_values jsonb,p_template uuid default null,p_prerequisite uuid default null)
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
 perform public.qb_save_task_plan(result,p_values);
 if p_values ? 'coin_reward' then perform public.qb_set_work_rewards('task',array[result],coalesce((p_values->>'xp_reward')::integer,30),coalesce((p_values->>'coin_reward')::integer,0));elsif p_template is not null then perform public.qb_set_work_rewards('task',array[result],coalesce((p_values->>'xp_reward')::integer,30),(select coin_reward from public.qb_task_templates where id=p_template));end if;return result;
end;
$$;
create or replace function public.qb_save_planned_milestone(p_id uuid,p_project uuid,p_values jsonb,p_revision integer default null)
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
 if p_values ? 'xp_reward' or p_values ? 'coin_reward' then perform public.qb_set_work_rewards('milestone',array[result],coalesce((p_values->>'xp_reward')::integer,0),coalesce((p_values->>'coin_reward')::integer,0));end if;
 return result;
end;
$$;

create or replace function public.qb_save_task_template(p_task uuid,p_name text,p_due_days integer,p_request uuid)
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
 insert into public.qb_task_templates(id,project_id,name,title,description,priority,xp_reward,coin_reward,due_days,checklist,created_by)
 select p_request,source.project_id,btrim(p_name),source.title,source.description,source.priority,source.xp_reward,source.coin_reward,p_due_days,
 coalesce((select array_agg(title order by position,id) from public.qb_checklist where task_id=p_task),'{}'),auth.uid();
 return p_request;
end;
$$;


do $grants$ declare f record;begin for f in select p.oid::regprocedure as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname||'.'||p.proname)=any(array['qb_private.reward_balance','qb_private.expire_rewards','qb_private.reward_release','qb_private.grant_task_rewards','public.qb_create_planned_task','public.qb_rewards_summary','public.qb_save_reward_item','qb_private.reward_xp','qb_private.reward_level_bonus','qb_private.guard_reward_config','public.qb_set_work_rewards','public.qb_save_task_template','public.qb_save_reward_settings','qb_private.reward_feature','qb_private.reward_post','public.qb_equip_reward','public.qb_save_planned_milestone','public.qb_recognize','qb_private.reward_lock','public.qb_adjust_coins','public.qb_redeem_reward','public.qb_manage_redemption','public.qb_claim_milestone_rewards','public.qb_transition_task']) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;end $grants$;
create function public.qb_reward_report(p_org uuid) returns table(id uuid,org_id uuid,user_id uuid,kind text,coins bigint,xp integer,source_id uuid,project_id uuid,reason text,actor_id uuid,idempotency_key text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not qb_private.is_org_member(p_org) then raise exception 'Organization unavailable' using errcode='42501';end if;
 return query select l.id,l.org_id,l.user_id,l.kind,l.coins,l.xp,l.source_id,l.project_id,l.reason,l.actor_id,l.idempotency_key,l.created_at from public.qb_reward_ledger l where l.org_id=p_org and (l.user_id=auth.uid() or qb_private.is_org_admin(p_org))
 union all select x.id,p.org_id,x.user_id,'task_xp'::text,0::bigint,x.amount,t.id,t.project_id,'Task XP approval'::text,null::uuid,('legacy-xp:'||x.id)::text,x.created_at from public.qb_xp_events x join public.qb_tasks t on t.id=x.task_id join public.qb_projects p on p.id=t.project_id where p.org_id=p_org and (x.user_id=auth.uid() or qb_private.is_org_admin(p_org));
end $$;
revoke all on function public.qb_reward_report(uuid) from public,anon;grant execute on function public.qb_reward_report(uuid) to authenticated;

create index qb_reward_settings_actor on public.qb_reward_settings(updated_by);
create index qb_reward_ledger_user on public.qb_reward_ledger(user_id);
create index qb_reward_catalog_creator on public.qb_reward_catalog(created_by);
create index qb_redemptions_approver on public.qb_reward_redemptions(approved_by);
create index qb_redemptions_fulfiller on public.qb_reward_redemptions(fulfilled_by);
create index qb_reward_unlock_user on public.qb_reward_unlocks(user_id);
create index qb_reward_unlock_redemption on public.qb_reward_unlocks(redemption_id);
create index qb_reward_awards_org on public.qb_reward_awards(org_id);
create index qb_reward_audit_actor on public.qb_reward_audit(actor_id);
create or replace function public.qb_create_quick_task(
 p_request uuid,p_project uuid,p_department uuid,p_title text,p_description text,
 p_due_date date,p_assignee uuid,p_xp_reward integer
) returns uuid language plpgsql security invoker set search_path='' as $$
declare destination uuid; existing public.qb_tasks%rowtype; department public.qb_departments%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_request is null or (p_project is null)=(p_department is null) then
  raise exception 'Choose a project or department' using errcode='22023'; end if;
 if p_title is null or char_length(btrim(p_title)) not between 1 and 160
 or p_description is null or char_length(p_description)>2500 then
  raise exception 'Enter a title (160 characters maximum) and description (2500 maximum)' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('qb-quick:'||p_request::text,0));
 if p_project is not null then
  if not qb_private.can_manage_project(p_project) or not qb_private.can_view_project(p_project) then
   raise exception 'Project unavailable' using errcode='42501'; end if;
  destination:=p_project;
 else
  if not qb_private.is_department_manager(p_department) then raise exception 'Department unavailable' using errcode='42501'; end if;
  select * into department from public.qb_departments where id=p_department;
  if not found then raise exception 'Department unavailable' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qb-queue:'||p_department::text,0));
  select id into destination from public.qb_projects where department_id=p_department and is_quick_queue;
  if destination is null then
   destination:=gen_random_uuid();
   insert into public.qb_projects(id,org_id,department_id,title,summary,created_by,is_quick_queue)
   values(destination,department.org_id,department.id,'No project · '||department.name,'Quick tasks without a named project. Visible to this department.',auth.uid(),true);
  end if;
 end if;
 select * into existing from public.qb_tasks where id=p_request;
 if found then
  if existing.created_by<>auth.uid() or existing.project_id<>destination then
   raise exception 'Request already belongs to another task' using errcode='22023'; end if;
  return existing.id;
 end if;
 insert into public.qb_tasks(id,project_id,title,description,due_date,assignee_id,reviewer_id,xp_reward,coin_reward,created_by)
 values(p_request,destination,btrim(p_title),p_description,p_due_date,p_assignee,auth.uid(),p_xp_reward,coalesce((select case when cfg.coins_enabled then cfg.default_task_coins else 0 end from public.qb_reward_settings cfg join public.qb_projects p on p.org_id=cfg.org_id where p.id=destination),0),auth.uid());
 return p_request;
end;
$$;

commit;
