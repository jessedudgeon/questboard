# Session 9 — Task dependencies and links

Date: November 2, 2026. Baseline: main `8c7cb01`.

## Behavior

Task pages show **Depends on** and **Needed by**, with navigable task buttons.
Project managers with visibility of both tasks can add/remove same-project links.
Self-links, cross-project links and cycles are rejected. Duplicate additions/removals
are idempotent. Completed/cancelled tasks must be reopened before dependency edits.

Dependencies mean finish-before-start. Only `complete` satisfies a prerequisite;
`cancelled` does not. Backlog tasks may be marked ready while waiting, but starting,
resuming, entering review and completing require every prerequisite to be complete.
Already-active tasks must be marked blocked before adding an unfinished prerequisite.
No task is silently restated or automatically reopened. Existing review/checklist/XP
rules remain authoritative.

A completed prerequisite cannot reopen while any direct dependent is in progress,
in review or complete. Reopen completed downstream work and mark active dependents
blocked first (request changes before blocking in-review work). For chains, work
backward from the final dependent. Cancelled/ready/backlog/blocked dependents do not
prevent reopening, and blocked work cannot resume until prerequisites complete again.

Copy task link includes only task and organization UUIDs. The recipient must sign in
and have current access. Navigation intent survives a clean OAuth callback in tab
storage; the organization is validated against active memberships before selection.
The task must exist in the authorized loaded workspace before navigation. No link
acceptance, membership grants or arbitrary redirect destinations are introduced.

## Security and concurrency

New `qb_task_dependencies` has RLS, same-project composite FKs, unique edge and
non-self constraints. Authenticated users have SELECT only; reads require visibility
of both endpoints. The write RPC verifies identity, management and both task scopes
before and after acquiring a project advisory transaction lock. All application graph
writes and transitions serialize on that lock; recursive cycle detection uses the
complete graph, including caller-hidden edges. PostgreSQL can abort conflicting
privileged direct writes; normal clients have no direct status/link write grants.

The task status trigger also enforces prerequisites and reopen safety on privileged
status updates. The existing transition RPC retains independent review, checklist
completion and one-time XP behavior; its additional lock is acquired before task locks.

`qb_dependency_readiness` returns only a waiting boolean for caller-visible task IDs
(maximum 100 requested), never hidden predecessor identities. Task-history audit text
is intentionally generic so a restricted predecessor cannot leak through the target's
history. Privileged SQL/service integrations must use the graph RPC to preserve cycle
checks; raw owner writes bypass the application authorization boundary.

## Validation

Local syntax plus 129 Node/PGlite tests pass. New SQL cases exercise links/removal,
cycles, same-project enforcement, direct-write denial, role/suspension boundaries,
workflow gating, reopening, independent approval, XP and hidden prerequisites.
Five UI cases exercise demo links, navigation, blocking, hidden readiness and direct
links through a clean callback. A browser scenario covers add/navigate/remove links.

Five additional native PostgreSQL races cover reverse links, concurrent link/start
in both orders and prerequisite reopen versus dependent start in both orders.
The PR CI executes the full suite, 20 PostgreSQL race scenarios and eight Chromium
scenarios. Browser/API fixtures are synthetic; hosted schema verification is separate.

## Rollout impact / recovery

Apply only `20261102190647_questboard_task_dependencies.sql`, after passing CI and
confirming existing Session 2–4 migrations. It creates an empty table, indexes,
read/write functions and status trigger, adds a composite task uniqueness constraint,
and replaces the transition function with the reviewed equivalent plus project lock.
No UPDATE/DELETE of existing business rows, invitation changes or MeetingDesk objects.
DDL uses a five-second lock timeout and one transaction, so lock failure rolls back.
The new unique index may briefly lock task writes; current production size is checked.

Apply and verify database objects/grants/RLS before merging the frontend. Existing
frontend remains compatible while the new table is empty. Retain the database rules
if the frontend must be rolled back. Never remove dependencies/constraints as an
automatic rollback once real links exist. Avoid replaying historical creation files.

Security advisor flags authenticated SECURITY DEFINER RPCs by design. Review their
explicit auth/scope guards, empty search_path and denied anon grants; internal helper
execution is revoked. Baseline also reports leaked-password protection disabled,
unrelated to these changes. References:
https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Next

Recurring task templates are next in the agreed feature backlog. Preserve explicit
review, avoid automatically cloning restricted participants/dependencies, and define
recurrence timezone, duplicate prevention and missed-run handling before rollout.
Microsoft configuration remains outstanding; Google sign-in is owner-confirmed.
