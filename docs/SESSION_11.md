# Session 11 — work calendar

Adds Calendar navigation with task due dates and project target dates, previous/next month and Today, project selection, assigned-to-me filtering and optional finished work. Department and global search filters still apply. Mobile screens show a dated agenda instead of seven narrow columns. Overdue and undated task lists cover all months and open existing task details. Project targets open project boards; they are hidden in the assigned-task view because they are not individual assignments.

The calendar derives entirely from the existing authorized workspace snapshot. It makes no additional requests or mutations. Missing parent projects are excluded; identity/organization invalidation resets calendar filters and dates. Date-only strings use local noon and strict round-trip validation so deadlines do not move across time zones. Project targets are existing dates, not a new milestone system.

Validation: 135 Node/PGlite tests pass, including leap-day, year-boundary, scope/filter, escaping, navigation, empty-state and identity-reset regressions. Desktop sample-workspace browser QA verified calendar rendering and assigned-work filtering. CI adds a mobile calendar scenario covering layout, navigation and organization switching, alongside existing browser and PostgreSQL suites.

No migration, provider setting, permission or MeetingDesk changes. Publish through the existing GitHub Pages workflow. Revert the frontend commit to roll back.

Remaining roadmap: recurring work, comments/@mentions and notifications, standalone milestones, richer personal/manager dashboards. Microsoft provider configuration and independent MeetingDesk acceptance remain separate outstanding work.
