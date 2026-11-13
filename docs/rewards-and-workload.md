# Rewards and workload

## Deployment

Apply `supabase/migrations/20261113184811_questboard_rewards_economy.sql` to the existing QuestBoard database before publishing the matching `dist/` assets. The migration is transactional, additive, and scoped to `qb_` objects; MeetingDesk objects are untouched. It preserves all existing task XP and does not backfill coins or milestone rewards. New reward tables have RLS and SELECT-only client grants. Controlled RPCs enforce authorization and perform mutations. Do not grant client INSERT/UPDATE/DELETE privileges on the ledger, catalog, settings, redemptions, unlocks, or audit tables.

The coins economy starts disabled. An organization admin opens **Rewards Store → Rewards administration → Organization reward policies**, enables coins, and chooses defaults and limits. Existing work is unchanged. Configure individual or selected task rewards and milestone bonuses explicitly. No payment gateway, real-money coin purchases, gift-card purchases, or subscription pricing is included.

## Accounting and workflow

- XP is non-spendable. Existing task XP remains in `qb_xp_events`; supplementary milestone, recognition, and achievement XP lives in `qb_reward_ledger`. The wallet summary and report combine them once.
- Coins belong to one organization. The append-only ledger is the balance source. There is no editable balance field.
- Task completion goes through the existing authorized transition RPC, retains checklist/dependency safeguards, and calls a single reward issuer. A durable source marker and unique ledger keys prevent repeated payouts. Existing XP records also block retrospective coin awards on reopened historical work.
- Tasks currently have **one assignee**. An unassigned or invitation-only task does not receive a personal payout. Assign an active account before approval. No implicit payment to the reviewer.
- Project leads explicitly award a milestone bonus after every non-canceled linked task is approved. The server checks all tasks, including ones absent from a partial client view. Bonuses default to an equal split among distinct assignees; whole-unit remainders use stable account-ID order. Admins may enable full awards per recipient. Reopening or repeating the claim does not pay twice.
- Recurrence is not newly implemented. Repeated work must use distinct task IDs/instances. A reopened task is the same reward source.
- New levels and achievements (1, 10, 50 newly rewarded tasks) may grant configured bonuses. There are no retrospective level bonuses. Historical task XP still contributes to the level calculation.
- Default XP caps respect the existing 500-XP task/template ceiling. Policy limits can be lowered. Existing paid rewards cannot be edited. Defaults affect future configured work, not historical records.
- Coin budget and maximum-holdings failures abort the whole award transaction, including task completion. An admin must resolve the budget or explicitly change unearned rewards before retrying. Reserved coins count toward maximum holdings. Release/refund paths can restore previously earned funds even after a recipient is suspended or the budget is reduced.

## Redemptions

A redemption atomically checks membership, wallet, inventory, dates, level/role eligibility, personal limits, organization period limits, and entitlements, then reserves coins and stock. All organization accounting is serialized by a settings-row lock; source keys and redemption request IDs are idempotent.

Approval-required requests begin Requested. Approvals become Approved, then Fulfilled by an admin. Digital rewards without approval fulfill immediately; approved digital requests also fulfill automatically. Fulfillment writes a zero-coin settlement because the reservation already deducted available funds. Rejection, cancellation, and expiration release coins and stock once. Physical fulfilled rewards can receive an audited coin refund; stock is not automatically replenished after physical fulfillment. Digital unlocks are permanent and are not refundable through that workflow.

Expiration is reconciled when a wallet is refreshed or a redemption action runs; no background scheduler is installed. Catalog inventory means **currently available** stock, excluding reservations. Period limits use UTC calendar months/quarters. Catalog edits do not rewrite a request's captured price, name, instructions, or approval requirement.

Four permanent digital effects are implemented: gold profile border, forest colors, Pathfinder title, and completion-star styling. Members can equip/unequip owned effects. Reduced-motion behavior is preserved. Organization admins create catalog entries for these effects or for their own tangible rewards. Organizations supply and fulfill their own physical rewards.

Pending approvals appear on the store navigation indicator and admin dashboard after refresh; this release does not send email or push notifications. A redemption can require admin approval without requiring separate final-confirmation approval from ChatGPT.

## Privacy and entitlements

Members see their own transactions, unlocks, and redemptions. Organization admins see organization-wide accounting, recognition, and fulfillment. Recognition by project leads is optional and requires an eligible recipient in a managed project. Ordinary XP/task views retain project access restrictions. The wallet exposes a member's aggregate organization XP without leaking restricted task titles. Organization switching clears reward data and discards stale responses.

`qb_reward_entitlements` is provider-owned (no client write grants) and prepares coins, digital/custom catalogs, approvals, budgets, and analytics for future subscriptions. Core transactional checks enforce coins, digital/custom rewards, approvals and budget feature gates; analytics entitlement is reserved for future billing integration. No prices or payment provider are hardcoded. Subscription fees and organization-funded physical rewards remain separate; coin amounts are never treated as dollars.

## Workload

**Staff workload** shows a six-week forecast, utilization, daily over-capacity flags, and weekly task drill-downs. Select a week/project/person, edit tasks through the existing forms, and export the selected week as CSV. Admins set per-person available weekly project hours; scope defaults remain available under Control panel.

Effort is spread evenly across each task's configured workdays. A finish-only task lands on its finish date. Remaining hours spread from today onward for current work. Milestone hours are budgets and are not double-counted. Missing estimates, unscheduled hours, overdue tasks, and total open effort are shown separately; a low scheduled total is not evidence of spare capacity. Capacity should exclude meetings, reactive support and leave. Workload is limited to visible managed work and active search/workspace/project filters; it is not a timesheet or a complete staff performance measure.

## Verification

`npm test` includes the migration, permissions, payout/idempotency, eligibility, budgets, redemption lifecycle, UI, organization reset, and workload regressions. `npm run test:postgres` uses the existing isolated PostgreSQL CI service and tests simultaneous inventory, balance, and issuance-budget operations. All fixtures roll back or use the disposable CI database. Never run those fixtures against production.
