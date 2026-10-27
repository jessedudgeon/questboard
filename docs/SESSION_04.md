# Session 4 — Membership Lifecycle and Administration

Date: October 27, 2026. Status: implemented on a review branch; not deployed.
PR: https://github.com/jessedudgeon/questboard/pull/5

## Verified baseline and production state

Read SESSION_03.md, fetched main, and inspected PRs #2, #3 and #4. Main is
`e75c588827e4b2d43bbbfcf7bb6469731baaf202`. PRs #2/#4 are merged. PR #3 is closed
because its commits were included in #4, rather than separately merged into its old base.
This session branches from that main commit.

Production still reports only the seven baseline migrations:
`20261026140022`, `20261026141132`, `20261026170546`, `20261026170602`,
`20261026170613`, `20261026170628`, `20261026170644`.
The Session 2 checklist guard and Session 3 candidate RPC are absent. Sessions 2–4
must not be treated as deployed. Pages run for current main was skipped; its preceding
successful deployment was baseline `0a538c8cd28c68846cda12112df68bfade7fcda9`.
No production data, schema, Auth/provider configuration or MeetingDesk objects changed.

## Delivered behavior

Administration is now available to authorized department managers and project leads as
well as organization admins. A scope selector loads a dedicated directory and the latest
50 membership events. Controls grant scoped access, change roles, suspend and reinstate.
The API requires the expected old role/status, preventing stale forms from overwriting
newer changes. Names are escaped, failed loads expose no controls, old responses cannot
replace a newer scope, and workspace reload clears administrative caches.

| Scope | Who can administer | Available operations |
|---|---|---|
| Organization | Active org admin | Change existing member/admin roles; suspend/reinstate existing members. New people still accept invitations. |
| Department | Existing department-management authority (active org admin or active explicit manager) | Grant/change/suspend/reinstate ordinary roles. Only org admins administer manager rows or grant manager role. |
| Project | Both existing project-management authority and project-content access | Grant/change/suspend/reinstate ordinary roles. Lead rows/grants additionally require org-admin authority. An org-admin role alone gives no project-content or project-management bypass. |
| Restricted participants | Existing rules unchanged | No new participant administration controls or removal permissions. |

Direct department/project UPDATE policies also protect existing leadership rows from
non-admin managers; this is an intentional tightening of the old demotion route. Existing
ordinary-role writes, creator membership triggers and invitation acceptance remain
supported. Leadership grants through the new API are scoped to administrators already
able to administer that scope. Suspended organization users cannot be granted or
reinstated into an active department/project membership.

The directory includes existing scoped members (including suspended people) for lifecycle
administration. New grant choices are active same-org people whose profiles the caller
can already see; org admins can select from their org roster. A non-admin manager may
need an org admin or invitation to add an unrelated colleague. Ordinary membership-table
read policies are unchanged; the new directory does not expose email addresses.

## Safeguards and audit

- Removing/demoting/suspending the last active org admin is rejected.
- Removing the last active explicit department manager is rejected, including indirectly
  through organization suspension. Org-admin fallback authority does not substitute for
  an explicit department manager in this continuity check.
- Removing the last manager who can actually access a project is rejected. Restricted
  projects require an explicit access path; a department manager outside the project is
  not sufficient. A manager with viewer project membership still counts while that
  membership remains active.
- These checks run on database writes, including privileged updates/deletes. The migration
  does not repair or backfill already-orphaned scopes. It prevents reductions of existing
  leadership coverage; creating a new department can still precede its first manager grant.
- Organization suspension overrides independent paths. Suspending one scoped membership
  does not remove other active paths. Reinstating an org does not reactivate explicitly
  suspended scopes or revoked invitations. Assignments/history are retained.
- `qb_membership_events` records org/scope/target, actor, timestamp and old/new role/status
  for actual insert/update/delete changes, including invitation/creator writes. No-op
  updates create no event. Failed transactions leave no event. There is no historical
  backfill. Privileged maintenance can have a null actor, shown as system.
- Audit rows have RLS and SELECT-only browser grants. Only administrators of that scope
  may read them. Browser roles cannot insert, edit or delete audit records. UUIDs are
  retained without deletion cascades to preserve evidence; privileged DB owners remain
  capable of altering records and are outside the browser threat model.

Writes serialize on the organization's row using NO KEY UPDATE locks (compatible with
foreign-key key-share locks). The new API locks before reading/rechecking actor authority
and expected state. Existing invitation/direct privileged paths can take member-row locks
first; a competing transaction may receive a deadlock/serialization error. PostgreSQL
rolls it back safely. Reload and retry the entire operation; never disable a guard. This
coarse lock is appropriate for low-volume administration, but throughput should be measured
before large imports. Native tests cover the principal contention scenarios, not every
possible lock interleaving.

## Migration review and deployment blockers

New additive migration:
`supabase/migrations/20261027153612_questboard_session04_membership_lifecycle.sql`.
It follows Session 2 `20261027120006` and Session 3 `20261027145136`.
It creates one QuestBoard table/index with RLS, scoped APIs/helpers/triggers and tightens
two named UPDATE policies. It rewrites no existing business rows. No MeetingDesk tables,
functions, policies, Auth users or provider settings are altered.

Read-only `scripts/session04-preflight.sql` returned zero organizations without an active
admin, zero departments without an active explicit manager and zero projects without a
manager with access. Re-run this and Session 3's preflight immediately before deployment.
A zero result is not a production acceptance test or permission to apply migrations.

Owner rollout actions:

1. Review PR #5, migration impact and recovery/backup readiness. Review the still-missing
   Session 2/3 migrations as well. Production retains the baseline findings until rollout.
2. Verify migration history again and reconcile the baseline mapping from SESSION_02.md.
   Apply only missing, reviewed additive migrations in order: Session 2 → 3 → 4.
   Never replay schema creation files or blindly push an unreconciled local migration set.
3. Verify function ACLs, RLS, last-role denials, invitation acceptance, suspension and
   reinstatement in staging with synthetic accounts; smoke-test MeetingDesk separately.
4. Only after all three migrations are verified, set repository variable
   `QB_SCHEMA_VERSION=20261027153612` and run Deploy QuestBoard from main after merging
   this PR. This PR advances the gate so a Session 3-only database cannot publish the
   Session 4 frontend. No variable was set and no deployment was requested here.
5. Validate hosted Google/Microsoft login, PostgREST role behavior and real account
   switching. Provider setup/redirect verification still requires owner participation.

The migration is transactional with a five-second lock timeout. On failure it rolls back;
inspect contention/errors before retrying. Prefer a forward fix. Frontend rollback may
retain database protections, but existing privileged scripts can now fail last-role checks.
A database rollback must explicitly review which safeguards/audit guarantees it removes.
Do not drop audit history during routine recovery.

## Validation

- `npm run check`: passed.
- `npm test`: 82 tests passing before the final direct-policy review; final results below.
- New SQL tests cover org/admin role transfer, ordinary scoped grants, suspend/reinstate,
  expected-state conflicts, last admin/manager protections, restricted management paths,
  anonymous/ordinary/cross-org denial, direct-write denial, audit integrity, and historical
  assignment/independent-path preservation.
- New DOM tests cover escaped names, suspended members, no removal action, stale scope
  responses, directory failures and expected-state RPC submission without optimistic mutation.
- A populated Session 3→4 upgrade proves existing memberships/tasks and an unrelated
  synthetic MeetingDesk table/policy remain unchanged; the new audit table starts empty.
- Existing regression fixtures now include a reserve admin/manager so their suspension
  cases exercise revoked access without violating the newly introduced continuity rules.
- Native PostgreSQL 17 CI passed initial implementation (run 40533960884). Final validation
  includes 15 concurrent-write scenarios, including direct-write and API last-admin races,
  last-manager races, stale updates and actor-demotion rechecks.
- Limitations: isolated auth shim, not hosted Auth/PostgREST; synthetic MeetingDesk canary,
  not a full MeetingDesk UI test; no production performance/load certification.

## Decisions and remaining work

Membership **removal** and **restricted-participant administration** remain unchanged.
Before adding either, decide who may perform it, whether removal is reversible, how it
interacts with historical work, and who may grant/remove restricted-task access. This
session adds no deletion endpoint or participant-management permission. Suspension is the
supported reversible workflow.

Priority backlog:

1. Review/deploy the missing migrations and smoke-test both applications and SSO.
2. Organization switching and session isolation: all caches and in-flight requests must be
   scoped to the current identity/org; add real browser integration coverage.
3. Decide removal/participant authority and design a narrowly scoped implementation.
4. Paginate/search large membership directories and audit history; measure RLS/lock costs.
5. Reconcile project lead display metadata with authoritative membership, then proceed to
   dashboards, dependencies/recurrence, notifications and progression features.

Recommended Session 5: **Organization Switching and Session Isolation**, with deployment
verification first. Do not begin widening removal/participant permissions by assumption.

Ready-to-copy prompt:

> Continue QuestBoard Session 5: Organization Switching and Session Isolation. Read
> docs/SESSION_04.md, inspect PR #5 and current main, and verify deployed migrations and
> Pages status. Implement explicit organization switching with identity/org-scoped caches,
> stale-request cancellation and safe sign-out/account-change handling. Preserve scoped
> membership administration, last-admin/manager safeguards, independent active paths,
> restricted-project boundaries, historical assignments and MeetingDesk compatibility.
> Test switches, suspended memberships and overlapping requests in isolated tests and
> browser integration where available. Do not assume Sessions 2–4 migrations are live or
> replay schema creation files. Keep membership removal and restricted-participant policy
> unchanged until explicitly decided. Include rollout blockers and a Session 6 prompt.

References reviewed: Supabase database functions guidance
(https://supabase.com/docs/guides/database/functions), current changelog, and Postgres
lock-ordering guidance. Definer APIs use empty search paths, explicit actor authorization
and revoked public/anonymous EXECUTE; arbitrary trigger helpers are not client-executable.
