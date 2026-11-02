# Session 10 — prerequisite selection during task creation

The task creation modal offers an optional Depends on picker scoped to visible tasks in the selected project. Switching projects clears the prerequisite and preserves the remaining draft. More prerequisites can be added from the task detail screen.

`qb_create_task` inserts the backlog task and calls the existing dependency RPC within one transaction. It runs SECURITY INVOKER with an empty search path, preserving existing task INSERT RLS, assignment triggers and dependency authorization. Authentication supplies creator/reviewer. Anonymous execution is revoked. Failed prerequisite validation rolls back the task and audit records. The UI retains the form on save errors. No existing records are rewritten.

The function generates its UUID before INSERT and avoids INSERT RETURNING: the existing task SELECT policy uses a lookup that cannot see the new row inside that command. Dependency checks run in the following command after insertion.

Validation: 131 Node/PGlite tests pass locally. Added atomic-save/rollback/permission coverage, demo creation and project-switch tests, and a Chromium scenario covering failed save/retry. CI also runs native PostgreSQL concurrency coverage. Browser tests use synthetic API responses; database tests exercise real SQL policies locally.

Deploy the additive `20261102200838_questboard_create_task_dependencies.sql` migration before the frontend. Reverting the frontend is compatible; keep the additive RPC. Existing security-advisor baseline: 10 intentionally guarded SECURITY DEFINER RPC notices and disabled leaked-password protection, unchanged by this SECURITY INVOKER function. References: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
