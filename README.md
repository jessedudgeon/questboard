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

The workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) deploys `dist/` on pushes to `main`.

1. Under **Settings → Pages → Build and deployment**, select **GitHub Actions** as the publishing source.
2. Run **Actions → Deploy QuestBoard → Run workflow** if the initial push did not deploy automatically.
3. Before switching the custom domain, verify the generated `https://jessedudgeon.github.io/questboard/` site.
4. When ready to cut over, configure `projects.dudgeon.io` under **Settings → Pages → Custom domain** and update its DNS CNAME to `jessedudgeon.github.io.`. Do not change the current DNS until GitHub Pages and authentication are ready.
5. Ensure your Supabase Auth URL allowlist includes the final GitHub Pages URL and `https://projects.dudgeon.io/`. Configure both Google and Microsoft identity providers before onboarding staff.

GitHub Pages hosts only the frontend. Supabase continues to host all application data and authorization logic. The website is publicly downloadable even though organization data requires authentication and database row-level authorization.

## Supabase

`dist/config.js` contains a **public Supabase publishable key**, which is intentionally safe to include in a browser app. Never commit the Supabase service-role key, database password, OAuth client secrets, or any other private credentials.

The SQL files in `schema/` document the additive QuestBoard tables, policies, and workflow functions. The running pilot uses the existing MeetingDesk Supabase project; do **not** rerun these creation migrations against that same project.

For a fresh project:

1. Apply `schema/001_questboard.sql`, then `schema/002_questboard_workflow_hardening.sql`.
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
