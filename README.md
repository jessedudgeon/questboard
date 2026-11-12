# QuestBoard

QuestBoard is a lightweight university project and task tracker with professional and RPG views.

The frontend is plain HTML, CSS, and JavaScript in [`dist/`](dist/). It connects to Supabase for Microsoft/Google OAuth, row-level access control, project/task data, journals, review transitions, and approved-work XP. No Node build is required.

## First-release features

- Department workspaces and separate project visibility rules.
- Dashboard, My Work, project boards, task details, reports, and administration.
- Organization-admin invitations, departmental roles, and scoped project access.
- Task assignment, objectives, updates, blocker reporting, review, approval, and XP.
- Professional/RPG presentation toggle.
- Link to the separate Minutes app; automatic action sync is not built yet.

## Project leadership reporting

QuestBoard records dated, append-only **project check-ins**. A project lead or authorized
department manager opens a project and posts a brief update containing:

- delivery owner (reporting-only; does not grant permissions) and delivery health
  (on track, at risk, blocked, or complete),
- meaningful accomplishments,
- next steps, risks/blockers, and decisions or support needed.

The **Reports** screen has two complementary, organization-scoped outputs:

1. **What we accomplished** aggregates the accomplishment notes entered during the
   selected 7-, 30-, 90-, or 365-day period.
2. **Where we stand & next steps** uses each project's latest check-in, target date,
   next active milestone, risks, and pending decisions. It flags check-ins more than
   14 days old rather than silently assuming a project is on track.

Both can be printed/saved as PDF through the browser or downloaded as standalone HTML.
They respect the current department/search and closed-project filters. There is no
automatic Microsoft Planner import; technicians may keep individual execution tasks in
Planner while managers record project-level delivery in QuestBoard. The existing Task
health report still measures only authorized QuestBoard tasks and should not be used as
an all-Planner completion metric.

Deploy the additive migration
`supabase/migrations/20261110180000_questboard_project_briefs.sql` **before** the new
frontend. The migration creates only `qb_project_briefs` with project-scoped read access,
manager-only insert access, and immutable history. It does not modify MeetingDesk tables
or existing QuestBoard records.

## Local preview

Serve `dist/` with any static web server. For example, `python3 -m http.server 8000 --directory dist` and open `http://localhost:8000`.

Use **Explore sample workspace** for a nonpersistent tour. All sample tasks and people are fictional.

## GitHub Pages deployment

The workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) publishes the contents of `dist/` at the site root whenever `main` is pushed, or when the workflow is manually dispatched.

1. Under **Settings → Pages → Build and deployment**, select **GitHub Actions** as the publishing source (not a branch/Jekyll build).
2. Open **Actions → Deploy QuestBoard → Run workflow** to start a new workflow run after changing the Pages source. Avoid re-running only the deploy job from an older run, since that may leave duplicate `github-pages` artifacts.
3. Set **Settings → Pages → Custom domain** to `projects.dudgeon.io` and configure a DNS CNAME of `projects` pointing to `jessedudgeon.github.io.`.
4. Confirm that `https://projects.dudgeon.io/` displays the application rather than this README. A README at the site root indicates that GitHub Pages is still serving the branch-based Jekyll output.
5. Ensure the Supabase Auth URL allowlist includes `https://projects.dudgeon.io/` and configure both Google and Microsoft identity providers before onboarding staff.

GitHub Pages hosts only the frontend. Supabase continues to host all application data and authorization logic. The website is publicly downloadable even though organization data requires authentication and database row-level authorization.

## Supabase

`dist/config.js` contains a **public Supabase publishable key**, which is intentionally safe to include in a browser app. Never commit the Supabase service-role key, database password, OAuth client secrets, or any other private credentials.

The SQL files in `schema/` document the additive QuestBoard tables, policies, and workflow functions. The running pilot uses the existing MeetingDesk Supabase project; do **not** rerun these creation migrations against that same project.

For a fresh project:

1. Apply `schema/001_questboard.sql`, then `schema/002_questboard_workflow_hardening.sql`, then `schema/003_questboard_qa_hardening.sql`.
2. Use your privileged Supabase administrative session to create an organization, add an authorized `auth.users` UUID as `qb_org_members.role = 'admin'`, add departments, and grant initial department managers. That bootstrap step is intentionally not included in the public migration because it contains organization-specific identity information.
3. Configure Google and Microsoft/Entra OAuth providers and redirect URLs in Supabase Auth.
4. Verify RLS with at least one user per role before opening the app to multiple departments.

## Current pilot limitations

- Identity providers and production redirects still require end-to-end verification.
- Invitations are created in the database and can be copied as links; automatic email delivery is not implemented.
- Minutes integration currently links to the meeting app; it does not synchronize actions automatically.
- Advanced talent trees, mastery tracks, and reward unlocks are planned beyond the first release.

## Security expectations

Always keep `qb_*` row-level security enabled. Role checks and task status transitions are enforced in PostgreSQL rather than trusting the mode or controls shown in the browser. Preview data is not stored. Invite acceptance requires an authenticated user with a matching verified email address.

## QA and regression checks

Run `node --check dist/app.js` and `node --test tests/frontend.test.cjs`. The Pages deployment runs these checks before uploading the application.

`tests/permissions.sql` runs disposable database fixtures inside a transaction and rolls everything back. It exercises allowed workflow transitions, denied viewer transitions, self-approval prevention, checklist enforcement, cross-organization scope rejection, invitation role upgrades, suspended managers, and one-time XP. Run it only through a privileged SQL connection.

The consolidated SQL in `schema/003_questboard_qa_hardening.sql` is already applied to the pilot as five named QA migrations. Do not rerun the initial schema on the pilot.

QA on 2026-10-26 confirmed Google is enabled but Microsoft/Azure is disabled in Supabase Auth. Microsoft SSO requires an Entra app registration: client ID, client secret, and tenant URL are currently empty. Google authorization begins successfully; the production redirect allowlist was verified in the Supabase dashboard. A real Google account callback still needs end-to-end verification. Keep `https://minutes.dudgeon.io/` configured and add the exact `https://projects.dudgeon.io/` redirect URL. QuestBoard returns all sign-ins, including invitation links, to its stable app URL and fetches email-matched pending invitations after sign-in.

## QuestBoard 2.0 baseline

See [Session 1 audit](docs/SESSION_01_AUDIT.md) for verified implementation status,
known authorization gaps, the prioritized backlog, and the Session 2 prompt.

Development checks now run with `npm ci --ignore-scripts`, `npm run check`, and
`npm test`. Node 22 is used in CI. The browser remains static HTML/CSS/JavaScript;
Node and the pinned PGlite dependency are only needed for tests.

The database test creates an in-memory PostgreSQL instance with a minimal
`auth.users` / `auth.uid()` test shim, loads the repository schema plus additive migrations there, then
runs `tests/permissions.sql`. It never connects to Supabase. This tests SQL/RLS
behavior, not Supabase Auth, PostgREST, or production schema equivalence.

`node tests/audit-known-defects.cjs` reproduces the five Session 1 database
findings locally. These probes assert the observed defects, **not** desired
behavior; they are deliberately outside the normal CI test glob. Convert them
to denial/regression tests as each issue is repaired. Do not run these fixtures
against the shared production database.


## Session 2 authorization hardening (proposed)

Read [Session 2 status and migration runbook](docs/SESSION_02.md) before deployment.
The new SQL under `supabase/migrations/` is additive to the existing pilot baseline;
merging code does not apply it. Do not replay `schema/001–003` or blindly run a database
push against the shared project. Production remains unchanged until migration review.

The normal `npm test` suite now covers hardened permissions and populated upgrades.
Historical diagnostic probes explicitly load the unpatched Session 1 baseline.
PR CI also runs `npm run test:postgres` against a disposable PostgreSQL 17 service for
real multi-session races. This command requires `QB_RUN_DATABASE_TESTS=1` and an empty
localhost `questboard_test` database using the test-only credentials in the workflow.
It does not accept a production URL. No production credentials belong in CI.

## Session 3 scoped identity (proposed)

Read [Session 3 status and rollout requirements](docs/SESSION_03.md). Scoped colleague
profiles and assignment eligibility depend on the additive Session 3 migration, applied
**after Session 2 and before the new frontend**. The migration is not applied by Pages.
Use `scripts/session03-preflight.sql` for read-only aggregate checks before review.

## Session 4 membership lifecycle (proposed)

[Session 4 report and rollout runbook](docs/SESSION_04.md) covers scoped grant/suspend/
reinstate administration, last-admin/manager safeguards and audit history. Apply the
reviewed Session 2, 3 and 4 migrations before enabling the Session 4 Pages gate
(`QB_SCHEMA_VERSION=20261027153612`). No production migrations are applied by merging.

## Session 5 organization/session isolation (proposed)

[Session 5 report](docs/SESSION_05.md) documents explicit organization switching, scoped
queries and stale-request cancellation. No new migration; the Session 4 schema gate still
applies. `npm run test:browser` runs synthetic Chromium integration tests; install its
browser with `npx playwright install --with-deps chromium`. Tests never sign into production.

## Notification inbox

Inbox shows assignments, review requests and decisions, reopened tasks, due-date changes,
and journal updates. Notifications begin after deployment; historical activity is not
backfilled. Self-actions do not notify the actor. Use Refresh inbox to fetch new activity.
Unread counts are organization-wide; department and search filters narrow the list.
The inbox uses stable pages of 50 with individual and page-level read controls.
Task access is checked on every read, including after suspension or visibility changes.

Apply `20261107125642_questboard_notification_inbox.sql` before deploying this frontend.
The additive migration creates RLS-protected notifications, trigger-only producers and
invoker-rights list/count/read RPCs. It does not alter MeetingDesk objects or existing tasks.

## Project portfolio reports

Reports opens a portfolio snapshot with project health, task signals, missed and upcoming
milestones, and a CSV export. Department, project search and health filters apply to the
cards, totals and export together. Click a task count to inspect its tasks; open a milestone
or project to continue planning. Closed projects are optional. Progress & recognition
retains the existing completion and XP view.

Health is rule-based, not a forecast. Past targets, overdue work, blocked/waiting tasks and
missed milestones flag attention. Unassigned/undated work, pending review and paused
projects flag watch. Cancelled tasks are excluded from completion percentages. All figures
use the current authorized workspace snapshot; hidden tasks are not counted. No schema
migration or additional data access is required for this build.

## Project settings and change history

Project managers and leads can edit a visible project's name, outcome, target date,
and status from Project settings. Planned, active, paused, complete and archived are
project-level labels: task workflow and access remain unchanged. A project can be restored
by returning its status to active. Settings cannot change the organization, department,
visibility or memberships.

Saves check a revision under a database row lock. A stale form keeps its draft and explains
how to reload before trying again. Refresh project fetches the current workspace. Change
history shows the latest 50 settings changes, including before/after values and actor when
that identity is available. History begins at rollout and follows current project access;
clients cannot forge or modify entries. Unchanged saves do not create history.

Apply `20261108112858_questboard_project_settings.sql` before deploying the frontend.
The migration adds a project revision, immutable RLS-protected history, private triggers,
and an invoker-rights save RPC. Existing project content and MeetingDesk data are preserved.

## All tasks and saved views

All tasks searches accessible task titles/descriptions and project names across the current
workspace. Combine project, assignee/reviewer, status, priority, deadline and dependency
filters; sort by date, priority, task or project. Open tasks are the default. Deadline
presets use local calendar dates; Next 7 days includes today and the following six days.
The list shows 50 matches per page; CSV exports include all matching authorized tasks.

Save up to 12 personal views per account and organization on this browser. Views store only
filter values and search text, never task snapshots. The current workspace still applies.
An existing view name replaces its filters; removing a saved view keeps current filters.
Views do not synchronize between devices. Demo views remain temporary. Storage errors
are reported without discarding filters, and unavailable saved project/owner filters do
not broaden the results. Account and organization changes reset active filters.

## Activity feed

Activity combines authorized journal posts and recorded status, checklist, task-detail,
and dependency events. Filter by project, person, event category and date range, or search
activity text, task names and projects. Presets use browser-local calendar days, including
today; custom start/end dates are inclusive. Invalid ranges show an error rather than
silently broadening results. Current workspace and task access always apply.

The feed shows 50 records per page; CSV export includes all matches with UTC timestamps.
Task history now uses readable summaries and links to all activity for that task. Unknown
or legacy payloads use generic descriptions; hidden dependency identities are not expanded.
This displays recorded history, not a complete audit of every field or a unique-action
count. Refresh activity fetches the latest workspace snapshot. No schema changes required.

## Quick tasks and Minutes

The global **Quick task** button creates a task with an optional project and due date.
**No project · Department** uses one shared department operations queue, preserving
existing task permissions, review and approved XP. New quick tasks start unassigned
with 15 XP; assign an owner and edit details from the task page. Creation remains
restricted to department managers, organization admins and eligible project leads.

Apply `20261110131119_quick_tasks_minutes.sql` before publishing this frontend.
The migration adds a queue flag and invoker-rights destination/create RPCs. A stable
request UUID prevents duplicate tasks on retries. It does not modify existing tasks
or MeetingDesk data. Minutes explicitly copies an action into a selected destination;
its local checkbox does not approve the QuestBoard task or grant XP.

## Weekly exception review

Under **Reports → Weekly exceptions**, review active projects with decision/support
requests, reported risks, blocked/waiting or overdue tasks, past-due milestones,
passed project targets, paused delivery, and missing or stale check-ins. Decision
requests appear first. Open a project from the report to record the next check-in.
Print/save PDF or download HTML to share the same filtered snapshot.

This is a current snapshot for a weekly review, not a seven-day change history.
Department and search filters apply; completed/archived projects are excluded.
Signals use only authorized QuestBoard records, not Teams Planner data. A milestone
with no visible tasks is unverified, and old check-in notes remain dated until a new
check-in supersedes them. No database migration is required for this report.
