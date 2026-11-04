# Session 14 — project task discovery

Project pages now offer Board and List views with owner, priority, dependency-readiness and due-date/priority sorting controls. Global search matches task titles and descriptions inside projects. Finished work is hidden by default; Include finished work exposes both completed and cancelled tasks in either view. Clear filters also clears the global search. Counts explain the filtered result while project summary totals remain unchanged.

The list retains keyboard navigation to task details and adds priority and dependency context. Global search remains available on mobile instead of being hidden. Controls wrap on narrow screens; board columns scroll horizontally. New projects reset owner/priority/dependency filters; returning from task details retains the current view. Organization/account invalidation resets all new state. Filtering operates solely on the existing authorized snapshot; it neither retrieves additional data nor changes permissions.

Validation: automated tests cover filtering combinations, date validation and sorting, project boundaries, stale owner selections, escaping, DOM controls, focus, task navigation and state reset. A mobile browser regression covers list filtering, search, clear, finished work and keyboard navigation. The complete Node/PGlite suite passes. Interactive browser QA uses the fictional sample workspace.

Deploy through the existing GitHub Pages workflow. No database migration, authentication changes or MeetingDesk changes. Roll back by reverting this commit.

Remaining roadmap: recurring work, comments/@mentions, notifications and standalone milestones. Microsoft provider configuration and independent MeetingDesk acceptance remain outstanding.
