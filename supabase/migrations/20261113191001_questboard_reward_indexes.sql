begin;
set local lock_timeout='5s';
create index qb_redemptions_catalog_scope on public.qb_reward_redemptions(item_id,org_id);
alter table qb_private.reward_installation add column singleton boolean not null default true primary key check(singleton);
commit;
