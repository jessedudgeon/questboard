begin;

-- Dated, append-only project check-ins: the portfolio reporting source of truth.
-- Planner remains optional; nothing here duplicates or imports individual Planner tasks.
create table public.qb_project_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.qb_projects(id),
  author_id uuid not null references auth.users(id),
  delivery_owner text not null default '' check (char_length(delivery_owner) <= 120),
  health text not null check (health in ('on_track','at_risk','blocked','complete')),
  accomplishments text not null default '' check (char_length(accomplishments) <= 4000),
  next_steps text not null default '' check (char_length(next_steps) <= 4000),
  risks text not null default '' check (char_length(risks) <= 2500),
  decisions text not null default '' check (char_length(decisions) <= 2500),
  created_at timestamptz not null default now(),
  constraint qb_project_brief_has_content check (
    length(btrim(accomplishments)) + length(btrim(next_steps)) +
    length(btrim(risks)) + length(btrim(decisions)) > 0
  )
);

create index qb_project_briefs_recent on public.qb_project_briefs(project_id,created_at desc,id desc);
alter table public.qb_project_briefs enable row level security;
revoke all on public.qb_project_briefs from public,anon,authenticated;
grant select,insert(project_id,author_id,delivery_owner,health,accomplishments,next_steps,risks,decisions) on public.qb_project_briefs to authenticated;

create policy qb_project_briefs_read on public.qb_project_briefs
  for select to authenticated using (qb_private.can_view_project(project_id));
create policy qb_project_briefs_insert on public.qb_project_briefs
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and qb_private.can_view_project(project_id)
    and qb_private.can_manage_project(project_id)
  );

-- The lack of UPDATE and DELETE grants/policies is intentional: reports retain history.
commit;
