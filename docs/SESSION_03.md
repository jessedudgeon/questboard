# Session 3 — Scoped Profiles and Assignment Permissions

Date: 2026-10-27. Status: merge authorized; database and frontend deployment pending.

## Verified starting point

Read `docs/SESSION_02.md` and inspected current main and PRs #2/#3 before implementation.
Main remains `0a538c8cd28c68846cda12112df68bfade7fcda9`. PR #2 is draft/unmerged at
`055dfedc5378d5cc7ddf7e82304ae774ce4363c1`; PR #3 is draft/unmerged at
`7f27fbcf3aca5c0f77ccfef86caf83521f924bc7`. This work includes PR #3. PR #4 was retargeted to main after merge authorization so
the full stack can merge together while preserving the original commits and deployment gate.

Read-only inspection of the shared MeetingDesk Supabase project found only seven baseline
migration versions: `20261026140022`, `20261026141132`, `20261026170546`,
`20261026170602`, `20261026170613`, `20261026170628`, `20261026170644`.
The Session 2 guard function and composite foreign key were absent. Neither Session 2 nor
Session 3 should be assumed live. No production schema, data, OAuth configuration, or
GitHub Pages deployment was changed in this session.

## Implementation and permission matrix

| Area | Implemented rule |
|---|---|
| F04 profile visibility | Own profile; active same-department collaborators; users sharing accessible projects; active org admins can see active same-org profiles. Unrelated same-org users, suspended collaborators and other-org users are excluded unless another legitimate shared scope exists. |
| Assignee / reviewer | Target must be active in the project's organization and have project access. Restricted tasks additionally require participation. Applies to insert and changed references on update. |
| Project access | Active project membership, or active department membership for department-visible projects. Independent active paths remain valid; organization suspension overrides all paths. |
| Department / project membership | Active destination-org membership required when granting/reactivating scoped access. Prior project access is not required because membership grants that access. Existing actor/role RLS remains authoritative. |
| Restricted projects | Department management alone cannot insert tasks or directly grant/update project membership in a project the actor cannot read. |
| Task participation | Target must already have project access. Participation can grant restricted-task access. Reading participant metadata now requires task access. |
| Identity changes | Membership user/scope and participant task/user identities cannot be retargeted. Membership updates grant only role/status; participant UPDATE revoked. |
| Historical references | Losing access does not erase historical assignments. Unrelated edits and clearing remain possible; a new assignment must satisfy current eligibility. |
| Candidate directory | Authenticated caller must both view and manage project; optional task must belong to it and be visible. Returns only eligible user IDs/display names, restricted to participants for restricted tasks. |

F04 is fixed in the proposed migration, not production. Membership roster policies remain
unchanged. Profile table column grants remain compatible; the frontend requests only IDs
and display names. The new directory returns no email addresses or role data. Internal
arbitrary-user helpers are not executable by browser roles, and definer functions use an
empty search path. Existing org-admin invitation authority is preserved.

Task forms load candidates for the selected project/task, clear obsolete choices when
switching projects, preserve draft text, escape names, ignore stale network replies, and
block saving when the directory fails. An unavailable current assignee/reviewer can be
retained during an unrelated edit without silently clearing history. Demo candidates now
come from explicit scoped membership fixtures rather than every sample person.

## Migration and compatibility

New additive migration:
`supabase/migrations/20261027145136_questboard_session03_scoped_identity.sql`.
It requires Session 2's `20261027120006_questboard_session02_authorization.sql` first.
It runs transactionally with a five-second lock timeout; creates scoped helpers, triggers
and the directory RPC; tightens named QuestBoard policies/grants. It rewrites no business
rows and touches no MeetingDesk or Auth objects. Locks serialize target suspension against
assignment and scoped-member grants. Suspension after an assignment may leave a historical
reference, but removes access.

Read-only `scripts/session03-preflight.sql` returned zero invalid assignments (no grouped
assignee/reviewer findings), zero participants without project access, and zero active
scoped memberships without active org membership. This is a point-in-time check, not a
production acceptance test. Re-run immediately before rollout. Do not automatically delete
or rewrite any historical references if later counts differ.

Deployment sequence requiring owner review:

1. Merge the reviewed stack while preserving the Pages deployment gate. The deploy job
   requires repository variable `QB_SCHEMA_VERSION=20261027145136`; leave it unset until
   both missing additive migrations are verified. Existing production remains served.
   Merging code does not apply SQL.
2. Recheck migration history and named functions/constraints; reconcile baseline history as
   documented in Session 2. Do not replay `schema/` creation files or blindly run db push.
3. Review database backup/recovery and preflight results. Apply only the reviewed, missing
   additive Session 2 then Session 3 migrations, using a controlled rollout window.
4. Verify policies/grants and directory RPC with synthetic staging identities. Publish the
   dependent frontend only after the RPC is available: set the repository variable above
   and manually run the Deploy QuestBoard workflow from main. Missing RPC fails closed and blocks
   task form saves; it does not fall back to an organization-wide roster.
5. Run hosted smoke tests for ordinary collaborators, project-only members, managers,
   restricted participants, suspended and cross-org users, then MeetingDesk smoke tests.
   Google/Microsoft SSO provider configuration still needs owner verification.

On SQL failure the transaction rolls back; investigate before retrying. Prefer forward
correction over dropping security guards. If frontend recovery is required, revert only
the frontend to its prior version while retaining database protections; old dropdowns can
offer ineligible users, but the database rejects their assignment. Any database rollback
must separately review the permissions it would reopen.

## Validation

- `npm run check`: passed.
- `npm test`: 64 passing tests, zero failed/skipped. Includes SQL role/target matrix,
  restricted tasks/projects, suspension, cross-org denial, anonymous/helper ACLs, identity
  mutation denial, unchanged historical references, five DOM interaction tests, baseline
  upgrade, and a populated Session 2-to-3 upgrade without replaying Session 2.
- MeetingDesk compatibility check uses an unrelated synthetic table/policy canary and
  verifies it remains unchanged. It does not certify the hosted MeetingDesk application.
- Native PostgreSQL 17 CI: passed (run 40527794722); ten concurrent-write scenarios,
  including suspension-before-assignment, assignment-before-suspension, and suspension
  versus project-member creation. Both test and postgres jobs succeeded.
- Tests use disposable local databases and an auth shim; no production credentials/data.
  Hosted PostgREST, real SSO, browser account switching and production performance are not
  covered by these isolated tests.

## Remaining backlog and Session 4

1. Review and coordinate deployment of the three stacked sessions, then verify hosted
   permissions/SSO/MeetingDesk behavior. Production still has the baseline findings.
2. Implement scoped membership administration and lifecycle flows: grant, suspend,
   reinstate, last-admin/last-manager safeguards, clear role summaries, and audit events.
   Explicitly decide who may remove memberships and administer restricted participants.
3. Add organization switching and prove caches do not retain a previous user's/org's
   directory or permissions. Validate invitation onboarding with real provider accounts.
4. Profile-directory performance at university scale, indexes/query plans, and pagination.
   Project `lead_id` display metadata is not a new permission grant and is outside this
   assignment guard; reconcile it with authoritative project membership in lifecycle work.
5. After the access foundation: dashboards, MeetingDesk integration contracts, and meaningful
   20-level progression, talent trees, mastery and achievements. Avoid frontend rewrites.

Session 4 recommended scope: **Membership Lifecycle and Administration**. Keep production
rollout gated on migration review; no live cleanup or automatic membership deletion.

Ready-to-copy prompt:

> Continue QuestBoard Session 4: Membership Lifecycle and Administration. Read
> docs/SESSION_03.md, inspect the stacked PRs and current main, and verify which migrations
> are actually deployed. Implement scoped grant/suspend/reinstate administration with
> appropriate last-admin/manager safeguards and audit history. Preserve organization
> isolation, independent active access paths, restricted-project boundaries, historical
> assignments, and MeetingDesk compatibility. Clarify membership removal and restricted
> participant administration before widening permissions. Use isolated role-matrix and
> concurrency tests and reviewed additive migrations; do not replay creation migrations
> or change production data without impact review. Include deployment blockers and a
> ready-to-copy Session 5 prompt.

Follow-up: [Session 4 membership lifecycle and administration](SESSION_04.md) advances
this rollout's schema gate to `20261027153612` when the Session 4 frontend is merged.
