# Session 5 — Organization Switching and Session Isolation

Date: October 28, 2026. Status: implemented for review, not merged or deployed.
PR: https://github.com/jessedudgeon/questboard/pull/6 (stacked on PR #5).

## Verified baseline

Read SESSION_04.md and inspected current main, PR #5, migration history and Pages runs.
Main remains `e75c588827e4b2d43bbbfcf7bb6469731baaf202`. PR #5 is open/unmerged at
`c4654346dbed5eb906c3477cb3cfd314869d73c1`; this branch starts from that head so the
membership lifecycle work is preserved. No PR was merged during this session.

Production reports only these baseline migrations:
`20261026140022`, `20261026141132`, `20261026170546`, `20261026170602`,
`20261026170613`, `20261026170628`, `20261026170644`.
Read-only function checks confirmed the Session 2 checklist guard, Session 3 candidate
RPC and Session 4 membership directory are absent. The current-main Pages run was
skipped; the preceding successful deployment remains
`0a538c8cd28c68846cda12112df68bfade7fcda9`.

## Delivered behavior

- Explicit organization selector lists only organizations returned for the current user's
  active memberships. Department filtering remains separate. Layout wraps on narrow screens.
- Switching resets navigation, filters/search, selected project/task, forms, task candidates,
  membership directory/history, admin rosters, invitations and all workspace rows. It
  refetches rather than restoring a previous organization's business-data cache.
- Organization choice is remembered in tab-scoped sessionStorage under a user-specific key.
  It is a preference, never authority: active membership is checked each time. No tokens,
  rosters, task data or history are placed in this preference storage. Existing theme
  preference and Supabase-managed auth persistence remain unchanged.
- Workspace loads assemble local snapshots and publish only after all scoped reads succeed.
  Active organization membership and role are rechecked before committing the snapshot.
  No membership means clean onboarding; suspension during a load yields a cleared error
  state. Suspended remembered organizations cannot be selected by a stale preference.
- Departments/projects are queried by org; members/tasks/history are fetched only through
  that org's department/project/task IDs. Profiles are limited to IDs referenced by the
  selected workspace. Filter lists are batched in groups of 100. Database RLS remains
  authoritative; client filters are an additional isolation/performance boundary.
- Organization metadata and pending invitations are identity-level data. Invitations to
  other organizations remain visible to their intended recipient to support joining them.
- A request generation plus AbortController invalidates old reads, directory loads and
  mutation completions. Late replies cannot populate a new account/org, show stale success
  messages or navigate it. Previously rendered forms cannot submit after a generation change.
- Account changes and sign-out immediately clear data, permissions, dialogs and toasts.
  The auth listener is registered before startup getSession; a newer auth event wins over
  an older startup reply. Token refresh revalidates workspace access. Async Supabase work
  is scheduled outside the synchronous auth callback.
- Sign-out retains Supabase's `scope: 'local'`; no global-session or shared provider change.
  If confirmation fails, the workspace stays cleared, a retry is offered, and sign-in is
  blocked until the sign-out attempt completes successfully. This is a UI lock, not a
  claim that an offline token has been revoked; reloading may restore an unrevoked session.
- Retry preserves the requested org. On errors, the organization selector remains available
  so the user can choose another active workspace.

Cancellation is not a database rollback. A write submitted before switching/sign-out may
already have committed; its late response is discarded. Reload the original scope to
verify uncertain outcomes rather than blindly retrying a mutation.

## Preservation and scope

No SQL, migration, permission policy, membership lifecycle, task-participant policy,
assignment rule, progression rule or historical record was changed. PR #5's last-admin/
manager safeguards, independent active access paths and restricted-project rules remain
in the dependency stack. No new membership removal or participant administration powers.
No MeetingDesk schema, data, frontend, Auth configuration or redirect setting changed.

## Validation

- Syntax check and the existing 82 tests pass.
- Eleven new isolated session tests pass: org switching/cache clearing/query scoping;
  overlapping org loads; account changes; sign-out failure; suspension before/during load;
  late candidate/directory responses; no memberships; stale mutation completion; startup
  auth races; detached forms; identity-scoped remembered-org validation.
- CI runs the combined 93-test suite and the existing 15 PostgreSQL concurrent-write
  scenarios on disposable data. No production credentials or data enter the tests.
- Playwright Chromium integration uses the actual app script and stylesheet with a
  synthetic in-memory Supabase adapter. Cases cover real selector interaction, account
  change with delayed replies, sign-out, suspension/token refresh, and narrow layout.
- Local Chromium download failed because the environment received an invalid archive.
  The first three browser scenarios passed in GitHub Actions run 40689430719, alongside
  the 93-test suite and all 15 PostgreSQL races. The additional responsive scenario is
  included in the final PR checks.
- The initial browser run failed in fixture initialization before executing the app. The
  fixture was corrected; no application result was inferred from that failed setup run.

These browser tests do not certify real Google/Microsoft SSO, hosted PostgREST behavior,
production schema equivalence or the MeetingDesk application. Database policy regressions
run separately in isolated PostgreSQL. There is no instantaneous server-push suspension
invalidation: loads, switches and token refresh revalidate; RLS controls subsequent API
requests. Full pagination remains a backlog item: existing server row limits can still
truncate large scopes, and history limits apply per batch rather than as a global feed.

## Rollout blockers and recovery

1. Review/merge PR #5 then this stacked PR, retargeting this PR to main after its dependency
   merges. Verify final CI and the Pages gate before merging; no live rollout is assumed.
2. Review and apply only the missing Session 2 → 3 → 4 additive migrations using the
   SESSION_04.md impact/recovery runbook and preflight scripts. Session 5 requires no new
   migration. Never replay creation files or push unreconciled migration history.
3. Verify hosted membership/assignment APIs and SSO with synthetic staging accounts,
   including two organizations, a project-only member, suspended membership, account
   change and both professional/RPG modes. Perform a MeetingDesk smoke test independently.
4. Only after that review and verification, enable `QB_SCHEMA_VERSION=20261027153612`
   and deploy main. This session does not set the variable or request deployment.
5. If frontend recovery is needed, redeploy the previously reviewed frontend commit while
   retaining the database safeguards. Review the older frontend's missing isolation fixes
   before using rollback as more than temporary recovery.

Owner participation is still needed for real provider-account acceptance testing and
review of the production migration/rollout impact. Membership removal and restricted-task
participant authority are still undecided and unchanged.

## Session 6 recommendation

**Authentication Acceptance and Controlled Rollout Readiness.** Close the gap between the
reviewed implementation and the still-baseline production system before adding more
features. Verify provider redirects and invitation journeys, review the outstanding
migrations together, and prepare a concrete acceptance/recovery record. Do not silently
reinterpret prior merge authorization as authorization for database rollout.

Ready-to-copy prompt:

> Continue QuestBoard Session 6: Authentication Acceptance and Controlled Rollout Readiness.
> Read docs/SESSION_05.md, inspect PRs #5/#6 and current main, and verify the actual Supabase
> migration and GitHub Pages deployment state. Validate Google/Microsoft sign-in, invitation
> acceptance, organization switching, suspension/reinstatement and account-change isolation
> using synthetic staging accounts where available. Review the missing Session 2–4 additive
> migrations, preflight results, MeetingDesk impact and recovery plan. Prepare a concrete
> rollout checklist and identify any owner login/configuration steps. Do not replay creation
> migrations, change production data or enable deployment without reviewed impact and
> authorization. Preserve all permission boundaries; leave removal and restricted-participant
> policy unchanged. Include test evidence, remaining blockers and a Session 7 prompt.

Implementation references reviewed: Supabase onAuthStateChange, signOut and abortSignal
API guidance and the current changelog. No Supabase SDK/provider configuration upgrade.
