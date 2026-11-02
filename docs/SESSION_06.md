# Session 6 — Authentication acceptance and recovery

Date: November 2, 2026.

## Verified baseline

Main is `1204e55`, incorporating PRs #5 and #6. Session 5's historical rollout
blockers are superseded by the production migration inspection in this session:
Sessions 2–4 are present as `20261028131112`, `20261028131121`, and
`20261028131129`. Their original source filenames differ from these recorded
application timestamps; do not replay them to reconcile filenames.

Read-only catalog checks find `qb_assignment_candidates`,
`qb_membership_directory`, `qb_manage_membership`, `qb_my_invitations`, and
`qb_accept_invitation`. All 15 public QuestBoard tables have RLS enabled.
This is presence verification, not a claim of full schema equivalence.

The public Auth settings endpoint reports Google enabled and Azure/Microsoft
disabled. Microsoft acceptance remains blocked on provider configuration.
A direct HTTP fetch of projects.dudgeon.io/app.js returned 403 from this execution
environment, so hosted asset parity was not inferred from that request.

## Changes

- Keep a persistent, accessible recovery message after OAuth cancellation or
  startup/session failures. Do not render raw provider errors or descriptions.
  Remove callback error parameters from the URL; leave successful token callback
  parameters untouched for the Supabase SDK.
- Disable duplicate sign-in attempts while pending and restore retry on failure.
  Allow only Google/Azure provider names and return only to this site's origin/path.
- Explicit public provider presentation config marks Microsoft unavailable until
  configured and tested. This flag is presentation, not authorization. The backend
  remains authoritative. Google remains available.
- Preserve a validated invitation UUID in tab-scoped session storage through the
  clean OAuth redirect. Show invited-address guidance and distinguish invitations
  returned by the account's existing RPC from an unavailable invitation. Never
  fetch arbitrary invitation records or automatically accept them. Users can dismiss
  the hint; successful acceptance of that invitation clears it. Account changes
  still clear all invitation records; the retained UUID is only navigation intent.
- Replace implementation-focused login instructions with user-facing guidance.

No database migration, production row mutation, Auth provider/redirect configuration,
MeetingDesk change, role-policy change, or membership-removal authority is introduced.

## Evidence and limits

`npm run check` and all 100 Node/PGlite tests pass, including seven new acceptance
regressions: callback errors/scrubbing; successful token preservation; unavailable
providers; deduplication and retry; invitation continuity/wrong-account handling;
blocked storage/malformed links; startup failure recovery.

The browser suite adds a narrow-screen signed-out acceptance test using the real
application/CSS with a synthetic Supabase adapter. Existing tests cover organization
switching, account changes, sign-out races and suspension. CI also runs 15 isolated
PostgreSQL concurrent-write scenarios. Consult the PR checks for execution results.
Synthetic tests do not certify real Google/Microsoft accounts or MeetingDesk saves.
No synthetic records were inserted in production.

Reviewed current Supabase signInWithOAuth documentation and changelog. The October
12 TLS cipher deprecation concerns legacy HTTP clients; this change introduces no
TLS overrides or SDK/framework changes. No schema upgrade is part of this release.

## Owner acceptance / remaining setup

1. Google: open QuestBoard in a private window, sign in as an invited account, and
   confirm the return URL stays on projects.dudgeon.io. Confirm the expected
   organization and permitted work load.
2. Invitations: share a newly created test invitation deliberately with its intended
   recipient. Check an invited account sees the invitation and accepts into the
   correct workspace; a different account should receive no access from the link.
   Check an expired/revoked invitation without accepting or mutating real user data.
3. Microsoft: configure the Entra application and Azure provider for the shared
   Supabase project. Verify callback/redirect settings preserve MeetingDesk as well
   as QuestBoard. After provider setup, enable `authProviders.azure` in dist/config.js
   and perform real-account acceptance; do not treat the UI flag as provider setup.
4. With designated staging identities, verify switching organizations,
   suspension/reinstatement, sign-out and a different account. Real identities and
   staging credentials were not available in this session.
5. Independently sign in to MeetingDesk and create/save a designated test meeting.
   Do not claim that the QuestBoard tests validate MeetingDesk's actual save flow.

## Recovery

Revert this frontend commit and redeploy through the existing Pages workflow if
needed. Retain all production database safeguards. No database rollback is needed.
The existing `QB_SCHEMA_VERSION` deployment gate is unchanged.

## Session 7 prompt

Continue QuestBoard Session 7: Complete Workspace Loading. Read docs/SESSION_06.md
and inspect current main and production deployment. Fix documented server-row-limit
truncation using bounded, deterministic pagination and a clear loading/error UX.
Preserve identity/org isolation, cancellation, restricted-project permissions and
historical records. Test scopes beyond 1,000 rows, late pages after org/account
switch, and failures mid-load. Preserve MeetingDesk and avoid replaying migrations.
Keep real-provider acceptance items visible; do not claim synthetic SSO tests certify
real accounts. Include evidence and a next-session prompt.
