# QuestBoard 2.0 — Session 1 of 30

Implementation audit and baseline assessment • October 27, 2026

## Assessment

QuestBoard is a functioning first-release foundation, not a completed 1.1 release.
Keep GitHub Pages, plain JavaScript, and Supabase. Prioritize authorization/workflow
hardening and SSO verification before dependencies, recurrence, or RPG expansion.
The presence of RLS is verified; comprehensive security is **not** certified.

### Evidence and verification boundaries

- Audited QuestBoard `main` at `0a538c8cd28c68846cda12112df68bfade7fcda9`.
- Read all frontend, schema, tests, README, and deployment workflow files. No repository AGENTS.md found.
- MeetingDesk integration review at `6af8c0b51030db28f8e49ba9b6326e43429dea9e`: cloud storage, workspace/action structure, setup SQL, package configuration. This was not a full MeetingDesk QA audit.
- Read production table RLS flags, policies, function definitions/ACLs, table and column grants, triggers, migration history, and advisors. No user meeting payloads or personal records were retrieved.
- Shared project: MeetingDesk, PostgreSQL 17.11, reported ACTIVE_HEALTHY.
- All 14 `qb_*` tables and `meeting_workspaces` have RLS enabled.
- Public auth settings returned Google enabled, Azure disabled, email enabled. This is current provider status, not proof of successful login.
- Production functions reviewed match the repository's main workflow and authorization logic. Seven applied migrations correspond to 001, 002, and the five consolidated QA fixes in 003. This is not an exhaustive schema-drift comparison.
- Direct fetches of production HTML/JS/CSS/config returned HTTP 403 from the audit environment; web retrieval was also unavailable. This does not establish a public outage. Deployed asset parity, Pages settings, DNS/TLS, live workflow-run success, and browser behavior remain unverified.
- No real Google/Microsoft account callback was completed. Redirect allowlist verification in README is historical (October 26), not freshly verified dashboard evidence.
- Automatic approval review blocked the production SQL test suite because it writes fixtures into shared production/auth tables despite rollback. It was not executed there. All executable database regressions and diagnostic reproductions ran in isolated PGlite PostgreSQL with synthetic data.

## Feature completion matrix

“Implemented” means present in source; validation limitations above still apply.

| Capability | Status | Evidence / remaining work |
|---|---|---|
| Departments and project workspaces | Implemented, defects | Tables, scoped access helpers, project creation/board; organization consistency gap F05 |
| Task creation, assignment, metadata editing | Implemented, partial | UI and SQL grants exist; assignment eligibility not enforced against target project membership |
| Task workflow, review, checklist, one-time XP | Implemented, defective | RPC state machine, row lock, self-approval rejection, unique XP task ID; bypasses F01/F02 |
| Google SSO | Partial | Client OAuth call and enabled provider; real callback and invite acceptance unverified |
| Microsoft SSO | Incomplete/configuration blocked | Azure client call includes email scope; provider currently disabled |
| Organization invitations | Partial, defective | Admin creation, copy link, verified-email discovery/acceptance, expiry, revoke RPC; F03; no email delivery |
| Org/department/project roles | Partial, defects | Database role helpers and RLS; no full membership lifecycle UI; profile visibility F04 |
| Restricted project/task access | Partial | Project membership and task participants enforced for reads; restricted-task creation/bootstrap has no supported UI path |
| Task dependencies | Missing | No dependency table, cycle handling, blocking semantics, or UI |
| Recurring tasks | Missing | No recurrence rules, occurrence identity, scheduling worker, or UI |
| Comments / work journal | Partial | Typed append-only task updates; no comment threads, editing, attachments, or mention semantics |
| @mentions and notifications | Missing | No mention/inbox/delivery entities or handlers |
| Project milestones | Missing | Target dates exist; no milestone entity or workflow |
| Calendar | Missing | Due dates exist; no calendar UI/feed |
| Personal dashboard | Partial | My Work, due-date sort, pending review; no complete personal planning dashboard |
| Manager dashboard | Partial | Authorized KPI counts, queue, progress bars, team table; no capacity, trends, aging, or historical snapshots |
| Professional/RPG modes | Implemented presentation | Labels/theme toggle; shared permissions and data |
| 20-level progression | Partial | Client formula `min(20,1+floor(sqrt(XP/65)))`; no agreed economy/unlocks or durable progression model |
| Talents, skill mastery, achievements | Missing | Explicitly future work; no supporting entities |
| MeetingDesk integration | Link only | Separate app link; no action import/sync or permissions mapping |
| Deployment and automated checks | Partial, improved in this branch | Static Pages workflow; added PR tests and isolated SQL runner; no hosted browser/E2E coverage |

## Security findings

### F01 — High: task insertion bypasses lifecycle controls

**Reproduced locally; production grants/policy inspected.** `qb_tasks` grants table-wide
INSERT; its insert policy checks project management and creator identity but not
initial status/completed_at. An authorized manager can insert an already-complete task
without review, checklist checks, a transition event, or an XP event. This is a lifecycle
integrity failure, not evidence that an unrelated outsider can access the project.

Remediation: enforce allowed initial state server-side, constrain system-managed
fields on creation, and cover direct API inserts as well as RPC transitions. Preserve
existing valid workflows. Acceptance: injected completion is denied, normal backlog
creation works, and review remains the only completion path.

### F02 — High: checklist writes bypass RPC protections

**Reproduced locally; production column grants inspected.** A manager can directly
update `qb_checklist.done` on a complete task. Broad table UPDATE/INSERT also allows
paths outside `qb_toggle_checklist`, bypassing closed-state checks and audit events.
The RPC itself does not lock the parent task before reading its status, leaving a
concurrency risk with completion; that race was identified by inspection, not reproduced.

Remediation: define allowed checklist mutations, narrow grants or provide controlled
RPCs, and coordinate task/checklist locking. Test closed tasks, new incomplete objectives
after review, concurrent changes, ordinary assignees, and manager metadata edits.

### F03 — High: old invitations can undo suspension

**Reproduced locally.** An unexpired pending invitation accepted by a suspended user
sets their organization membership active. Scoped acceptance also preserves the higher
existing role. Acceptance does not recheck whether the original inviter is still an
active administrator. An old invitation can therefore undermine later access removal.

Remediation: make suspension authoritative; require an explicit authorized reinstatement
flow, invalidate pending invites on suspension, and recheck issuer/scope authority at
acceptance. Decide whether fresh invitations may ever reinstate suspended membership.
Default recommendation: they may not. Test matching/mismatched verified emails, expiry,
revocation, suspension, inviter removal, role changes, and repeated acceptance.

### F04 — Medium: profile RLS hides colleague names

**Reproduced locally.** `qb_profile_read` checks shared organization membership through
`qb_org_members`, whose SELECT policy exposes only the caller's membership unless the
caller is an org admin. A regular department member cannot read a colleague's profile,
even though task/project access is legitimate. The UI falls back to “Team member.”

Remediation: introduce a narrowly scoped profile-visibility helper based on authorized
collaboration, returning only intended profile fields. Do not grant everyone blanket
access to organization membership data. Test department managers, project-only users,
suspended users, and unrelated organizations.

### F05 — High: department reparenting breaks organization consistency

**Reproduced locally using an admin of both organizations.** `qb_departments` has
whole-row UPDATE permission and its policy validates administration of the old/new
organization. Updating `org_id` succeeds while existing projects retain their original
`org_id`. There is no composite FK enforcing that project and department organizations
match. This breaks the authorization model's assumed hierarchy; broader disclosure
was not demonstrated.

Remediation: prevent ordinary department reparenting, enforce relational consistency,
and audit existing mismatches with read-only queries before adding constraints. Any
future transfer feature must move/revalidate the full hierarchy deliberately.

### Additional findings requiring tests or policy decisions

- Assignment/reviewer/participant/member references point to `auth.users` without a
  server-enforced active membership/access relationship for the target project. The
  frontend's member picker combines memberships across projects. Users can be assigned
  work they cannot see. Add scope-aware assignment eligibility and explicit tests.
- Department managers can manage a project even when its visibility prevents reading
  it. Review direct task/member insertion paths against the intended restricted-project
  policy; do not silently expand manager access.
- Viewer role does not mean universally read-only: any task viewer may post journal
  entries, and an assigned viewer can operate workflow RPCs. This is present behavior
  (the current SQL test deliberately assigns work to a viewer), not automatically a
  defect. Resolve semantics before changing it.
- Task participant SELECT permits reading one's own participant row without an active
  org check; task content remains separately protected. Test post-suspension metadata access.
- Restricted tasks have no automatic initial participant; default UI creates inherited
  visibility only. Add a safe atomic participant bootstrap if restricted creation is exposed.
- Mutable assignments/reviewer/XP and partial metadata audit payloads need abuse and
  history tests. One-time XP currently persists through reopening and is tied to task ID.
- Security advisors flag five authenticated-callable SECURITY DEFINER RPCs. They are
  intentional APIs with authorization checks and empty search paths; the warning alone
  is not proof of a vulnerability. Public/anon execution is revoked for these RPCs.
  Later private trigger functions retain default ACLs; review default privileges as hygiene.
- Shared-project leaked-password protection is disabled. Email auth is enabled and
  MeetingDesk uses passwords, so password settings cannot be assessed as OAuth-only.
  Coordinate any change with MeetingDesk. No auth settings changed.

Advisor references:
- [Privileged RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)

## Authentication and invitation follow-up

The client uses explicit `location.origin + location.pathname` as OAuth return URL;
it does not include invitation query parameters. After login it discovers all matching
pending invitations with `qb_my_invitations`; the link ID is not treated as bearer access.
Acceptance verifies email confirmation, matching address, pending state, expiry, and scope.
Local sign-out uses scope `local`, avoiding an intentional global sign-out across apps.
Shared Supabase identity does not imply shared browser sessions across the two origins.

Microsoft requires an Entra application, supported-account/tenant decision, client ID,
secret configured securely in Supabase, and Web callback
`https://efehgfntchczottrmosm.supabase.co/auth/v1/callback`.
Choose a university tenant restriction unless external Microsoft accounts are needed.
Use the current Supabase guidance for verified email claims and tenant configuration.
Never put a client secret in GitHub, config.js, or chat.

Keep both exact application redirects allowed:
- `https://projects.dudgeon.io/`
- `https://minutes.dudgeon.io/`

The provider's callback is the Supabase URL above, not either application URL.
Google's current client/consent audience and the allowed redirect list still need
owner verification. Test Google and Microsoft using invited users, cancelled consent,
wrong account, expired invite, returning session, sign-out, and account switching.
Regression-test MeetingDesk login/save after shared Auth configuration changes.

References: [Azure setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure),
[Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google),
[redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Architecture and maintainability

- Static `dist/` is source, not a generated build. The app is one 256-line file with
  very long rendering functions and global state; CSS is similarly dense. Extract
  data access, permission presentation, and render functions incrementally as they
  change. A framework rewrite is not needed for the next milestones.
- RLS helpers in `qb_private`, column-scoped task updates, immutable workflow events,
  and a one-event-per-task XP ledger are useful foundations worth preserving.
- `loadLive` loads broad tables then filters in memory. Unpaginated collections can
  truncate at the API row cap. Journal/events use a global 200-row limit before
  task/org filtering, so busy workspaces can hide older task history. Introduce scoped
  queries and explicit pagination before multi-department scale testing.
- Every save reloads most application data. No realtime subscription, concurrency
  token on task metadata, offline queue, or observable error reporting is present.
- Org selection chooses the first membership (or just-accepted organization), without
  an organization switcher; the visible workspace switcher selects departments only.
- Runtime Supabase JS is a floating `@2` CDN dependency, unlike MeetingDesk's pinned
  2.102.0 import. Pin a verified version and validate both apps; do not upgrade blindly.
  Browser CSP/integrity and accessibility/mobile coverage are future hardening work.
- Performance advisor: 13 unindexed foreign keys and three unused indexes. Prioritize
  project org/department, XP user, and actual measured query paths. Do not delete pilot
  indexes merely because the advisor has not observed usage yet.
- Migrations 001–003 are creation/consolidation files, not a safe production replay
  stream. Add a mapping of applied versions and use new reviewed additive migrations.
  The fresh-schema test does not replace upgrade-path tests on a production-like clone.
- Pages publishes `dist/` on main pushes. CNAME is currently at repo root; actual
  custom-domain settings were not verified. The existing workflow had only syntax and
  six frontend tests, no PR gate or SQL tests. This branch adds tests without deploying.

### MeetingDesk integration contract

Production MeetingDesk uses an owner-scoped `meeting_workspaces` row with JSONB
`payload`, `revision`, and `updated_at`, protected by `auth.uid() = user_id`.
Source uses version-1 meeting/template data, nested action IDs, free-text owners, and
optimistic revision checking in `save_meeting_workspace`. It is not an org-wide meeting
schema. Do not expose whole private meeting payloads to department managers or make
QuestBoard automatically update them.

Recommended first integration: explicit, user-initiated action-to-task export with a
new QuestBoard link table containing owner/source meeting/action IDs, destination task,
and a unique source identity for idempotency. Resolve free-text owners to verified users
with review. Authorize both source ownership and destination project rights. Keep the
existing MeetingDesk JSON contract and revision semantics intact. Add bidirectional
status sync only after conflict rules, consent, and deletion behavior are specified.

## Tests and completed changes

| Check | Result |
|---|---|
| Original frontend syntax check | Passed |
| Original frontend tests | 6/6 passed |
| Fresh schema 001–003 in isolated PostgreSQL | Passed |
| Existing SQL permission suite | Passed locally; rollback leaves zero auth fixtures |
| New task-form XP regression | Passed: zero retained, omitted defaults to 30, 60 retained |
| Combined final test suite | 8/8 passed (7 frontend, 1 database suite wrapper) |
| Five diagnostic database probes | All five defects reproduced locally |
| Production RLS/grants/functions/advisors | Read-only inspection completed |
| Production permission fixture suite | Blocked; not executed |
| Hosted browser / real OAuth / deployment parity | Not verified |

Changes in this session:
1. Correct task form parsing so an explicitly supplied valid 0 XP is not replaced by
   30. Current visible dropdown offers 15/30/60/100, so this is a defensive parser fix;
   no reward options or economy were changed.
2. Add pinned PGlite dev dependency and lockfile, minimal auth test shim, and reusable
   isolated database runner. No Node runtime is added to production.
3. Add diagnostic reproductions for F01–F05, outside the passing regression glob.
4. Add pull-request CI and make Pages validation run the expanded tests, using Node 22.
5. Add this audit and usage documentation. No production migrations or settings changed;
   no MeetingDesk files changed. Changes are proposed on a review branch, not deployed.

Testing gaps: auth callback/event handling; PostgREST return semantics; direct malicious
writes; full role/visibility matrix; anonymous/suspended/cross-org reads; fresh vs existing
migration upgrades; races; stale sessions; paging; end-to-end forms; mobile/keyboard
accessibility; load/performance. Existing `must_deny` treats any SQL error as a denial,
so future tests must assert expected error classes and include positive controls.

## Prioritized backlog

| Priority / ID | Work | Acceptance / dependency |
|---|---|---|
| P0 QB-01 | Harden initial task state and checklist writes (F01/F02) | Direct bypasses denied; valid worker/reviewer paths pass; locking tested |
| P0 QB-02 | Suspension-safe invitation acceptance (F03) | Stale invite cannot restore access; explicit reinstatement policy |
| P0 QB-03 | Enforce organization hierarchy consistency (F05) | Reparent blocked; FK/trigger strategy reviewed against existing data |
| P1 QB-04 | Scoped profiles and assignment eligibility (F04) | Valid teammates named; outsiders hidden; inaccessible assignments rejected |
| P1 QB-05 | Finish Google/Microsoft SSO | Both real callbacks + invites pass; MeetingDesk login/save unchanged |
| P1 QB-06 | Expand authorization matrix and migration verification | Anonymous, each role, suspension, restricted scopes, malicious direct writes covered |
| P1 QB-07 | Member administration and org switching | Safe role/suspend/revoke flows; explicit role semantics |
| P1 QB-08 | Scoped queries, pagination, runtime version pin | Correct data beyond API limits; stable reviewed client dependency |
| P1 QB-09 | Task dependencies | No cross-org/cyclic edges; explicit readiness rules; follows permission hardening |
| P1 QB-10 | Recurring tasks | Timezone/DST rules; unique occurrences; retry-safe scheduler; no duplicate XP |
| P1 QB-11 | Comments, mentions, notification inbox | Recipient visibility rechecked; restricted content not leaked in notifications |
| P1 QB-12 | Milestones/calendar | Authorized project linkage, due dates, filtering, accessible calendar |
| P1 QB-13 | Personal/manager dashboards | Scoped workload, overdue/aging/review queues; clear partial-data semantics |
| P2 QB-14 | MeetingDesk action export | Explicit import, stable IDs, idempotency, no JSON breaking change |
| P2 QB-15 | 20-level progression economy | Reviewed rewards, thresholds, reopening/transfer rules, no permissions unlocks |
| P2 QB-16 | Talent trees, mastery, achievements | Versioned criteria and grants; professional equivalents; anti-farming tests |
| P2 QB-17 | Production readiness | Browser/accessibility/load/security regression, observability, backup/restore/runbooks |

These are dependency priorities, not a claim that each row fits one session. The
30-session estimate must allow time for real-account testing, provider administration,
permissions decisions, and shared-project integration. Finish 1.1 workflow/collaboration
capabilities before broad 1.5 integration and 2.0 progression/polish.

## User participation and decisions

- Entra/Supabase owner: configure Microsoft credentials securely; choose university-only
  vs broader tenant access and perform consent if required.
- Complete Google and Microsoft real-account sign-in and matching invitation tests.
  Preserve MeetingDesk redirects and regression-test its sign-in/save.
- Confirm suspension cannot be undone by an old invite (recommended default), and
  whether viewers may comment or perform assigned work.
- Decide the intended restricted-project manager access model; org administration
  currently does not automatically confer project-content access.
- Provide/authorize a suitable staging environment before production-like upgrade and
  concurrent PostgREST tests. Local PGlite covers much of SQL, not the entire service.
- Review the branch/PR before merging. No production database changes are proposed in
  this session; a future migration requires an impact review and deployment plan.

## Recommended Session 2

**Authorization and workflow hardening, with reviewed additive migrations.** Target
F01/F02/F03/F05 first; address profile visibility if it fits after these release blockers.
Convert diagnostic probes into expected-denial tests. Preserve existing role boundaries,
inspect existing data with read-only integrity queries, and prepare a migration plus
upgrade tests, impact summary, and rollback/forward-repair strategy. Do not deploy it
until reviewed. SSO owner setup can proceed alongside this work; keep acceptance testing
as an explicit remaining gate rather than declaring it done from config alone.

### Ready-to-copy Session 2 prompt

```text
Begin QuestBoard 2.0 — Development Session 2 of 30: Authorization and Workflow Hardening.

Repository: https://github.com/jessedudgeon/questboard
Production: https://projects.dudgeon.io
Related app: https://minutes.dudgeon.io
Architecture: GitHub Pages + Supabase shared with MeetingDesk.

Read docs/SESSION_01_AUDIT.md and inspect the current main branch and Session 1 PR
(audit/session-01-baseline) before making changes. Reuse completed work and identify
any intervening changes. Run npm ci --ignore-scripts, npm run check, and npm test.

Prioritize F01 (task insert lifecycle bypass), F02 (checklist direct-write/locking
bypass), F03 (stale invitations undo suspension), and F05 (department organization
reparenting). Use tests/audit-known-defects.cjs as reproductions; convert repaired
cases into expected-denial regressions with positive controls. Address F04 profile
visibility only after these blockers or if it shares the same safe changes.

Preserve current organization isolation and role boundaries. Default to suspension
remaining authoritative; do not broaden restricted-project access or viewer powers.
Inspect existing data read-only before constraints. Use isolated synthetic fixtures,
never production auth.users fixtures. Do not rerun schema/001–003 on production.
Prepare only new additive reviewed migrations, with upgrade-path tests and an impact
and rollback/forward-repair plan. Do not apply production database changes before
reviewing impact. Do not change MeetingDesk's JSON schema, data, or authentication
redirects. Do not introduce an unnecessary frontend rewrite.

Track Microsoft provider configuration and real Google/Microsoft sign-in testing as
owner-dependent gates. Never request secrets in chat or store them in the frontend.

Deliver tested fixes in a reviewable PR, updated feature/security status, test evidence
and limitations, migration impact, remaining decisions/blockers, and a Session 3 prompt.
```
