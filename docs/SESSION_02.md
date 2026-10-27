# QuestBoard 2.0 — Session 2 of 30

Authorization and workflow hardening • October 27, 2026

## Outcome and release state

Four priority findings are addressed in code and a proposed additive migration:
F01, F02, F03, F05. **They remain present in production until the migration is reviewed
and applied.** No production mutation, auth configuration change, or MeetingDesk edit
was performed in this session. This is not a complete security certification or 1.1 release.

Session 1 PR #2 is still a draft and main is still `0a538c8`. This work is stacked on
`audit/session-01-baseline` at `055dfed`, with a separate draft [PR #3](https://github.com/jessedudgeon/questboard/pull/3).
Merge Session 1 first, then retarget Session 2 to main and recheck CI before merging.
Neither PR has been merged by this session.

## Changes

| Finding | Implemented protection | Preserved behavior |
|---|---|---|
| F01 task insert bypass | INSERT policy requires backlog and null completion timestamp | Authorized managers can create tasks; status updates still use existing RPC |
| F02 checklist bypass/race | Direct completion writes revoked; add/metadata trigger locks parent; edits frozen in review/complete/cancelled; RPC locks parent; centralized audit; approval rechecks objectives | Managers add/edit open objectives, assigned workers toggle via RPC, request-changes/reopen restores editing |
| F03 suspension bypass | Reject suspended organization/scoped members; recheck active admin issuer; ordered membership locks; conflict guards; revalidate locked invite and expiry; suspension triggers revoke pending matching invites | Verified users can accept valid invitations; active memberships can upgrade without downgrading; repeat acceptance denied |
| F05 org reparenting | Department updates limited to name/color; composite project→department/org FK | Department rename/color and valid project creation unchanged |

Frontend now disables checklist completion and hides the add-objective form in review
and closed states. The database remains authoritative even with a modified client.

No changes to project-content visibility, viewer commenting/assigned-work semantics,
XP economy, SSO providers, or MeetingDesk's JSON contract. The restriction on editing
reviewed objectives is intentional: request changes first, then edit and resubmit.

## Validation

- `npm ci --ignore-scripts`, `npm run check`, `npm test`: **35 tests passed** locally.
- The original SQL permission suite still passes on a freshly migrated isolated database.
- New tests assert specific PostgreSQL SQLSTATEs, verify allowed operations, and cover
  six forbidden initial task states, completion timestamps, direct status/done writes,
  review/closed objectives, assigned-worker behavior, legacy incomplete review tasks,
  scope/issuer/suspension/email/expiry/replay checks, and hierarchy consistency.
- Populated-baseline upgrade preserves all sampled business rows and a synthetic
  MeetingDesk table's data, owner policy, and RLS setting.
- A deliberately inconsistent baseline makes the migration fail with 23503; after
  rollback neither its earlier grant changes nor its unique constraint remain.
- `tests/concurrency.cjs` is a separate native PostgreSQL 17 CI suite. It uses three
  connections, observes actual lock waits, and tests seven races: edit before review,
  review before toggle, review before insert, suspension before acceptance, acceptance
  before suspension, issuer demotion before acceptance, and simultaneous acceptance.
  It also runs the original SQL permission suite on native PostgreSQL.
- Both CI jobs passed in [run 40501482691](https://github.com/jessedudgeon/questboard/actions/runs/40501482691): 35 regular tests and all seven native PostgreSQL race scenarios.
  The native suite is deliberately outside normal
  PGlite test glob and requires explicit opt-in, a localhost-only disposable database
  named `questboard_test`, and an empty schema. It cannot take a production URL.

Read-only production aggregate checks returned zero for project/department organization
mismatches, complete tasks missing completion timestamps, closed tasks with unfinished
objectives, unexpired pending invites to suspended org members, and pending invites to
suspended scoped members. These checks establish only those specific conditions.
Run `scripts/session02-preflight.sql` again at deployment time; it also includes
in-review tasks with incomplete objectives and all pending suspended-member invites.

Limitations: PGlite uses a minimal auth shim. Native CI is PostgreSQL, not hosted Supabase
Auth/PostgREST. Real OAuth callbacks, actual browser interaction, and a hosted staging
upgrade still require verification. The local container could not initialize a native
server under a non-root OS user, so native race validation is performed in disposable CI.

## Migration inventory and compatibility

New file: `supabase/migrations/20261027120006_questboard_session02_authorization.sql`
(created with the Supabase CLI migration command).

The historical baseline is NOT duplicated into this directory:

| Existing production version | Repository baseline |
|---|---|
| 20261026140022 questboard_initial_workspaces_tasks | schema/001_questboard.sql |
| 20261026141132 questboard_workflow_hardening | schema/002_questboard_workflow_hardening.sql |
| 20261026170546 questboard_fix_project_scope | Part of schema/003 |
| 20261026170602 questboard_fix_task_transition_authorization | Part of schema/003 |
| 20261026170613 questboard_fix_checklist_and_suspended_manager | Part of schema/003 |
| 20261026170628 questboard_fix_invitation_scope | Part of schema/003 |
| 20261026170644 questboard_fix_invitation_role_updates | Part of schema/003 |

This directory is an additive delivery artifact, not a fully reconciled Supabase CLI
history. **Do not blindly run `supabase db push`, reset, or creation scripts against the
shared project.** Review the current migration ledger and apply only this new migration
with the appropriate reviewed migration mechanism. Do not repair/mark historical
versions merely to make a push command succeed.

Fresh local tests load schema 001–003 and then the new migration. Existing-database
upgrade tests load baseline fixtures first and apply only the new migration afterwards.
Historical `audit-known-defects.cjs` intentionally loads baseline without new migrations;
it remains a record of how Session 1 defects were reproduced, including still-open F04.

## Impact review and deployment runbook

### Expected impact

- Transactional changes to QuestBoard policies, grants, functions, triggers and constraints.
  No existing task, membership, invitation, XP, profile, or MeetingDesk row is rewritten
  by applying the migration itself. Future suspension revokes matching pending invites.
- Table/index locks during unique/FK creation; a 5-second lock timeout aborts rather
  than waiting indefinitely for locks. It is not a total execution timeout. A larger
  database may require a separately reviewed concurrent-index/NOT VALID strategy.
- Existing hierarchy mismatches abort the migration atomically. They are not repaired
  automatically. Existing incomplete tasks in review must request changes before approval.
- Direct clients updating checklist completion must use `qb_toggle_checklist`; clients
  updating department fields other than name/color must stop. The current UI supports
  these paths and its updated controls accurately reflect frozen review state.
- Invitation acceptance no longer reinstates suspended users. Reinstatement requires
  an explicit privileged administrative action; this session does not add that UI.
  Invites created after suspension also cannot bypass it.
- Existing pending invites for users already suspended before this migration are not
  retrospectively rewritten. If preflight finds any, stop and review/revoke them before
  deployment so they cannot later be reused after manual reinstatement.
- Locking serializes changes on the same task and invitations sharing an issuer/member.
  Heavy contention can reduce throughput. Deadlocks from external mixed-order writes
  roll back a transaction; callers should retry the whole operation after refreshing.

### Before applying

1. Review PR #3 and final CI results; verify required baseline functions/policies and
   applied migration versions still match. Confirm the exact shared project reference.
2. Confirm backup/restore availability and export current definitions/grants for affected
   QuestBoard objects, keeping any sensitive backup outside the public repository.
3. Run the read-only preflight. Investigate nonzero results; do not automatically alter
   business data. Confirm RLS remains enabled on all QuestBoard and MeetingDesk tables.
4. Run a hosted staging/PostgREST smoke test with admin, worker, viewer, reviewer, and
   suspended identities. Verify new-task creation, add/toggle objectives, submit,
   request changes, approve, reopen, and invitations. Test MeetingDesk login/save.
5. Review the above impact and schedule a quiet deployment window. No migration is
   applied by merging the PR or by GitHub Pages CI.

### Apply and verify

Apply **only** the new SQL file once using the reviewed migration mechanism. The file
contains BEGIN/COMMIT and a local lock timeout. If any statement fails, roll back; do
not proceed by executing selected later statements or granting broader permissions.

Then verify the composite constraint and narrowed column grants, the three suspension
triggers, checklist guards/audit trigger, empty function search paths, and anonymous RPC
execution denial. Run Supabase security/performance advisors and review intentional
SECURITY DEFINER RPC warnings. Use authorized staging fixtures for write regressions;
production verification stays read-only unless separately authorized.

Deploy the tested frontend through Pages after review; a temporary database-first
rollout is safe because old clients receive errors rather than bypassing enforcement.
Verify real-account QuestBoard sign-in and MeetingDesk sign-in/save. Record the applied
migration version, frontend commit, advisor results, and smoke-test results.

### Rollback / forward repair

- Before COMMIT: ordinary transaction rollback restores all migration changes. The
  inconsistent-hierarchy test proves earlier grants/constraints do not partially remain.
- After COMMIT: prefer a new reviewed forward repair. Frontend can be reverted independently,
  but keep enforcement; the previous UI may show controls that the database rejects.
- Do not blindly drop the new guards/constraint or restore broad grants: that reopens the
  documented bypasses. Any schema rollback needs an explicit security-impact decision,
  captured pre-change definitions, and staging tests.
- Suspension-triggered invite revocations after deployment are business changes; do not
  bulk reactivate them during rollback. If access is legitimately restored, review the
  member and issue a fresh scoped invite instead.

## Remaining backlog and owner decisions

| Priority | Item | State |
|---|---|---|
| Release gate | Review/apply Session 2 migration and smoke-test hosted behavior | Pending; production unchanged |
| P1 | F04 colleague profile visibility | Still open; keep visibility narrowly scoped |
| P1 | Project-aware assignee/reviewer/member/participant eligibility | Still open |
| P1 | Restricted-project manager behavior and full role matrix | Preserve current boundaries until explicitly decided |
| P1 | Google callback and Microsoft/Entra setup | Google enabled/Azure disabled at last check today; real callbacks unverified |
| P1 | Membership lifecycle UI, org switching, pagination | Still open |
| Later | Dependencies, recurrence, mentions/inbox, milestones/calendar, dashboards | No feature completion claimed this session |
| Later | MeetingDesk action export, meaningful progression/talents/mastery/achievements | Unchanged |

Owner participation: review migrations before production application; complete provider
configuration securely in Entra/Supabase and real-account SSO tests; confirm the intended
viewer and restricted-project manager semantics before future permission expansion.
Never send OAuth secrets in chat or commit them to the repository.

## Session 3 scope and prompt

Recommend **scoped identity visibility and assignment eligibility**, then the expanded
role matrix and SSO verification checklist. Finish authorization foundations before
introducing dependency/recurrence writes or integration APIs.

```text
Begin QuestBoard 2.0 — Development Session 3 of 30: Scoped Profiles and Assignment Permissions.

Repository: https://github.com/jessedudgeon/questboard
Production: https://projects.dudgeon.io
Shared Supabase backend with MeetingDesk: https://minutes.dudgeon.io

Inspect current main and PRs #2/#3. Read docs/SESSION_01_AUDIT.md and docs/SESSION_02.md.
Determine which changes are merged and which migration versions are actually applied;
do not assume Session 2 is deployed. Reuse the existing local and native PostgreSQL tests.

Fix F04 so authorized collaborators can see needed names without exposing unrelated
organization membership. Enforce project-appropriate assignee, reviewer, member and
participant eligibility in the database, and scope the frontend selectors accordingly.
Add role-matrix tests for admins, department managers, project leads, workers, reviewers,
viewers, suspended users, project-only members, and cross-organization outsiders.
Do not broaden restricted-project access or viewer capabilities without a clear decision.

Preserve GitHub Pages, Supabase, organization isolation and MeetingDesk's JSON/data/auth
contracts. Use synthetic local/CI fixtures; no production auth fixtures. Do not replay
schema/001–003 or blindly push an unreconciled migration history. Prepare new additive
reviewed migrations with preflight, upgrade tests and an impact/forward-repair plan.
Keep production deployment separate from code preparation until impact is reviewed.

Track Google real-account callback and Microsoft/Entra setup as explicit owner-dependent
gates. Deliver a tested PR, updated status/backlog, migration impact, remaining decisions,
and a ready-to-copy Session 4 prompt.
```

Follow-up: [Session 3 scoped profiles and assignment permissions](SESSION_03.md).
