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
`auth.users` / `auth.uid()` test shim, loads the repository schema there, then
runs `tests/permissions.sql`. It never connects to Supabase. This tests SQL/RLS
behavior, not Supabase Auth, PostgREST, or production schema equivalence.

`node tests/audit-known-defects.cjs` reproduces the five Session 1 database
findings locally. These probes assert the observed defects, **not** desired
behavior; they are deliberately outside the normal CI test glob. Convert them
to denial/regression tests as each issue is repaired. Do not run these fixtures
against the shared production database.
