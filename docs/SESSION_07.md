# Session 7 — Complete workspace loading

Date: November 2, 2026. Baseline: main `1aa3da5`, Session 6 merged/deployed.
The owner confirmed Google sign-in works after that release. Microsoft configuration
and independent MeetingDesk save-flow acceptance remain outstanding.

## Delivered

Workspace collections now request pages of at most 250 rows with explicit stable
ordering and primary-key tie breakers (including composite membership keys).
Queries retain their organization/project/task filters, and parent ID lists remain
batched by 100. Invitations returned by `qb_my_invitations` are also paginated.
Pagination advances by the actual returned row count and ends on an empty page,
so a server cap smaller than the requested page size does not masquerade as completion.

Removed the silent 200-entry-per-batch limits from task journals and task events.
Tasks, journals and events are sorted globally after combining batches. The loading
screen reports records received; the completed workspace is published only after
all reads and the existing active-membership recheck succeed.

A generation check and AbortController protect every page; late replies after
organization switching, account changes or sign-out cannot populate the new workspace.
Repeated primary keys cause a retry error rather than duplicate data/counts.
A failed page exposes the existing retry UI with no partial workspace published.

Bounds: 20,000 rows per logical table collection and at most 200 requests per paged
query. Exceeding a bound displays an explicit error rather than silently truncating.
This supports the current in-memory UI while avoiding unlimited eager loads. Very
large organizations will need server-filtered views and on-demand history.

## Validation

Syntax and all 109 Node/PGlite tests pass locally. Nine new regressions cover >1,000
tasks/history/invitations, server caps below the requested size, composite membership
keys across parent batches, page failure/retry, delayed pages across three identity
boundaries, duplicate detection and oversized-workspace errors.

The synthetic browser fixture now enforces ordering, range offsets and a configurable
server cap. A sixth Chromium scenario loads 1,105 tasks with a 71-row cap and verifies
the project count and complete board. CI runs all browser scenarios and the existing
15 PostgreSQL concurrency scenarios; inspect PR checks for final results.

No schema, production data, permissions, provider settings or MeetingDesk changes.
Existing directory/assignment RPC calls are outside this workspace-loading pass;
they still require pagination for very large eligible-person lists. Membership history
continues to show its explicitly labeled latest 50 entries.

Pagination is ordered but is not a database snapshot across HTTP requests. Duplicate
rows caused by concurrent edits are detected; deletes/reordering can still shift offset
boundaries without duplicates. Refresh retrieves current data. A future snapshot/keyset
API is needed for stronger concurrent-edit consistency. RLS remains authoritative.

## Recovery and continuation

Revert the frontend commit and redeploy through the existing Pages workflow if needed.
No database rollback or replay of historical migrations is appropriate.

Next session: implement paginated assignment/membership directories, then return to
the agreed feature backlog (task dependencies, recurring work, comments/mentions,
notifications, milestones/calendar and personal/manager dashboards). Read this handoff,
inspect main/deployment, preserve all scoped access and stale-response protections,
and test large candidate lists without populating production with test accounts.
