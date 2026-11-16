# QuestBoard — active development roadmap

**Updated:** November 16, 2026  
**Baseline reviewed:** `main` at `08bb3a472aaa574e42f446393b12d83a65705b29` (merged PR #34)  
**Product:** Multi-organization project/task management with optional RPG progression  
**Related product:** MeetingDesk at `minutes.dudgeon.io`

This is the **current source of truth for forward development**. [Session 1 audit](SESSION_01_AUDIT.md) is a historical October 27 baseline, not a list of today's outstanding defects. Update this document after a feature merges or a release gate is verified.

## Evidence and status language

- Reviewed merged GitHub pull requests, current source files, documentation, CI, and the GitHub Pages deployment result. The November 16 `main` deployment and PR checks succeeded.
- Queried the connected shared Supabase project's migration history. The planning/capacity, rewards, indexes, and ownership/removal migrations from November 13 are present.
- **Implemented** means the relevant code/schema is merged, not that every production user journey has passed acceptance testing.
- **Partial** means a subset of the original request works, with material remaining scope.
- **Unverified live** means an authenticated production-browser or provider-specific test has not been conducted during this review. A successful Pages deployment does not establish end-to-end OAuth, email delivery, payment, or data-access correctness.
- No application code, production configuration, database schema, or user data was changed as part of this roadmap review.

## Completed capability baseline — preserve rather than rebuild

| Capability | Verified implementation evidence | Remaining acceptance focus |
| --- | --- | --- |
| Scoped organizations and administration | Multi-organization login/switching, self-service organizations, invites, role controls, ownership transfer and scoped removal; PRs #5–6, #15, #33 | Production account/role matrix and organization boundaries |
| Project/task workflow | Boards and lists, inline status and assignee edits, quick tasks, milestones, dependencies and creation-time prerequisites; PRs #10–11, #16–20, #26–27, subsequent `main` commits | Exercise full role-specific table interactions in live browser |
| Planning | Relative/fixed task dates, milestone date bounds, task/milestone hours, workload and capacity forecasting, vendor contacts and follow-up; November 13 changes | Real workload samples and changing-anchor edge cases |
| Dashboards and reports | Personal/manager dashboards, portfolio health, historical project check-ins, executive/timeline exports, staff handoffs and weekly exceptions; PRs #14, #18, #22, #28–31 | Output quality and large-project performance |
| Notifications and activity | In-app notification inbox, filtered task history and activity; PRs #21, #25 | Timely delivery beyond manual refresh; mentions |
| Rewards | XP progress, earned history, organization coins/store, approvals/fulfillment, basic achievements, cosmetics and staff capacity; PR #32 and November 13 commits | Economy tuning, organization policy UX, future paid-plan gating |
| UX/help | Navigation sections, mobile handling and nine searchable in-app How-to guides; PR #34 | Usability verification, content maintenance; avoid cosmetic redesign |
| MeetingDesk | Explicit, authenticated action-to-QuestBoard-task export with idempotency; PR #26 | Not automatic or bidirectional status sync |

## Original audit backlog reconciliation

| ID | Original objective | Status as of review |
| --- | --- | --- |
| QB-01–03 | Task/checklist authorization; safe invitations; hierarchy consistency | **Implemented** in Session 2 hardening; production regression remains a general release gate |
| QB-04 | Scoped profiles and valid assignments | **Implemented** |
| QB-05 | Google and Microsoft/Entra sign-in | **Partial.** Google code and prior pilot exist; `dist/config.js` currently sets `authProviders.azure: false`. Real-provider acceptance remains |
| QB-06 | Role/visibility, upgrade, direct-write tests | **Partial.** Extensive isolated CI tests exist; production-like authenticated acceptance and migration parity remain |
| QB-07 | Members, invitations, organization switching | **Implemented** through PR #33 |
| QB-08 | Scoped loading, pagination, runtime reliability | **Implemented in core paths**; continue measured performance hardening rather than assuming scale-ready |
| QB-09 | Dependency graphs and prerequisites | **Implemented** |
| QB-10 | Recurring tasks | **Not implemented** |
| QB-11 | Comments, @mentions and notifications | **Partial.** Journal and inbox implemented; no threaded comments/@mentions/recipient delivery |
| QB-12 | Milestones and calendar | **Implemented** |
| QB-13 | Personal and manager dashboards/capacity | **Implemented in core**; real-world capacity tuning remains |
| QB-14 | MeetingDesk action export | **Implemented for explicit creation**, not automatic two-way sync |
| QB-15 | Progression and economy | **Implemented core**: XP, coins, store, rewards and basic achievements |
| QB-16 | Talents, mastery and richer achievements | **Not implemented** (basic achievements already exist) |
| QB-17 | Production readiness | **Partial**: CI and Pages deployment pass; signed-in E2E, performance, Auth, operational recovery remain |

Additional work completed since the audit: project-change history, vendor tracking, exception reports, professional exports, task-table editing, capacity settings, and How-to guides. Do not reopen these for redesign without a reproducible defect or measured usability need.

## Prioritized remaining delivery plan

### P0 — Pilot reliability and release verification (next)

**Goal:** A trustworthy multi-department pilot before inviting more users.

1. Verify Google sign-in, organization creation, role transitions, restricted projects, task approval/reward payout, invitation expiry and organization switching in **authenticated production/staging browsers** with at least two organizations and each major role. Include mobile keyboard/accessibility smoke tests.
2. Decide and configure Microsoft/Entra tenant and consent policy. Enable `azure` only after provider credentials, redirect URLs, and real callbacks work. Re-test MeetingDesk sign-in/save because both apps share Supabase Auth. Do not commit secrets.
3. Compare deployed code to applied migrations and check API grants/RLS against production-like accounts. Review Supabase security advisor findings individually; elevated RPC warnings are review candidates, **not proof of exploitable defects**. See [SECURITY DEFINER lint](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
4. Run tests with meaningful project/task volumes, report exports, organization switching, mobile menus and fast repeated edits. Capture latency and errors; fix measured bottlenecks.
5. Verify backup/restore, error monitoring, migration deployment/rollback notes, and a simple incident/support workflow. Keep access to the shared MeetingDesk database bounded.

**Done when:** documented real-account acceptance matrix passes; both identity providers are validated (or Microsoft is explicitly deferred with disabled UI); no unexplained cross-org access or release-blocking errors; staging/production migration inventories agree.

### P1 — Finish planned v1.1 daily-work features

**QB-10: Recurring tasks.** Model a series separately from occurrence task IDs, timezone and daylight-saving rules, daily/weekly/monthly patterns, skip/end options, assignment and milestone behavior, future-generation horizon, editing a single occurrence versus the series, retry-safe scheduled generation and one-time XP/coin payout per occurrence. Test duplicate jobs, reopen, suspension and disabled organizations.

**QB-11: Collaboration.** Add task-scoped threaded comments and permission-aware @mentions using existing journal/activity patterns where appropriate; preserve restricted-task visibility. Support mention notifications, unread/reply flows, auditing, safe rendering and optional moderation/retention. Do not replace the existing journal unless user tests demonstrate a need.

**Notifications and invitations.** Make in-app inbox timely (refresh or live updates); add optional email for invitations, assignments, mentions, approvals, overdue/vendor follow-ups, with user preferences, unsubscribe, reliable retry and non-leaking content. Do not claim background jobs exist until deployed. Avoid duplicate notices.

**Done when:** ordinary staff can repeat work safely, converse on accessible tasks, get relevant notices without polling manually, and recover from retries without duplicate tasks or awards.

### P2 — Integration and project-management polish

1. **MeetingDesk:** Keep existing explicit action export. Add stable cross-app link display and status reconciliation *only after* deciding source of truth, user consent, ownership mapping, conflicts, deletions, permission changes and retry semantics. Bidirectional writes are a separate later decision.
2. **Manager experience:** Validate live inline task/board controls, invitation-only assignees, check-in dropdown clipping, capacity forecasts, milestone revisions, and report chronology. Fix specific failures; do not reopen a blanket UI redesign.
3. **Reports:** Resolve documentation drift on dates/duration bars, verify PDF and HTML output in real browsers, improve schedule variance/change-reason reporting if actionable. Distinguish target, baseline, revised target and actual completion; do not invent forecast dates.
4. **Maintainability:** `dist/app.js` is a large monolithic static file. Extract well-tested modules incrementally around changed features; preserve the existing architecture unless performance or correctness demonstrates a need for a rewrite.

**Done when:** integration paths are consented/audited and manager reports are reliable for real meetings.

### P1 (commercial-release gate) — SaaS launch track

This is **new scope**, beyond the old 30-session implementation audit. It is high priority for a paid launch but should not block using QuestBoard internally; design can proceed in parallel with pilot workflow work.

1. Define plan tiers, limits, trial, entitlements, organization owner/billing administrator, billing contacts, grace periods, suspension/read-only behavior, cancellations and data export. Keep organization reward coins **separate from real money**.
2. Implement a payment-provider-backed subscription lifecycle with verified webhooks, idempotency, entitlement refresh, invoices, payment failures, upgrades/downgrades and support tools. Never let untrusted browser fields grant a paid entitlement.
3. Validate org isolation, self-service onboarding, abuse controls, per-tenant limits, auditability, deletion/export, privacy/terms and customer support before offering subscriptions.
4. Run purchase → activate → change plan → failed payment → cancel → rejoin scenarios against a test payment environment. Check that one organization's billing events cannot affect another.
5. Add instrumentation for sign-up activation, feature adoption, retention, paid conversion, and operational alerts only with appropriate privacy controls.

**Done when:** a new paying organization can self-serve safely and its subscription, data and features remain correctly isolated throughout the lifecycle.

### P3 — Optional progression depth after workflow and commercial gates

- Expand achievements beyond the implemented basic counters; add mastery and optional talent tracks with professional-mode equivalents.
- Define XP/coin balance tuning, anti-farming rules, responsible real-world reward approval and organization budget controls.
- Consider deeper gamification only if user engagement evidence supports the cost. Do not mix real currency and in-app coins.

## Next five work packages, in order

| Order | Package | Output / acceptance |
| --- | --- | --- |
| 1 | **Release acceptance & Entra setup** | Role-based E2E checklist, live browser proof, shared-auth regression, security triage |
| 2 | **Recurring task engine** | Database model, scheduler, series/instance UX, no duplicate recurring rewards |
| 3 | **Comments and @mentions** | Task threads, access tests, mention notifications |
| 4 | **Notification delivery & invitations** | Reliable invitation emails and opt-in task alerts with retries/preferences |
| 5 | **SaaS architecture decision** | Plan/entitlement specification, billing-state diagram, threat model, test strategy |

Integration reconciliation follows these unless a business dependency pulls it forward. Paid subscriptions require P0 and the full SaaS launch gate, not just the architecture decision.

## Decisions to record before implementation

- Microsoft Entra: university-only or general Microsoft identities? Which environments and test accounts are available?
- Recurrence: supported patterns, series ownership, whether occurrences inherit milestone/target constraints, and when reward accrual begins.
- Collaboration: comments versus official work journal, notifications preferences, moderation and attachment policy.
- MeetingDesk: explicit export only for now, or approved one-way/two-way status updates?
- Paid product: trial duration, initial paid tiers/limits, billing administrator authority and cancellation retention.
- Delivery: staging environment, release manager, backup owner and support contact.

## Updating this roadmap

After each merged feature, mark its requirement status and link its PR; after any deployment, record independent acceptance evidence. Do not mark a feature **fully validated** merely because a migration exists or tests pass. Preserve completed designs unless concrete defects or measured user friction justify change.

## November 16 addition — project template library

Implemented six curated IT project templates with search, full previews, and
atomic creation of a planned project, milestones, tasks, and checklists. Suggested
calendar dates are seeded from the chosen start date; tasks follow milestone
deadlines. Permissions and retry/rollback behavior are covered by isolated tests.
Custom organization templates and save-project-as-template remain future scope.
