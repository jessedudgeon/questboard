# Session 12 — personal and manager dashboards

Adds Overview / My dashboard / Manager dashboard controls to the home page. Personal view includes open assignments and tasks awaiting the current user's review. Manager view includes only authorized tasks in managed departments or projects led by the current user. Both honor workspace and search filters.

Panels show overdue tasks, the coming seven calendar days (today plus six days), explicitly blocked work and pending reviews. Manager view adds unassigned work and expandable assignee workload lists. Counts are task counts, not effort estimates or capacity. All rows open existing task details. Closed and cancelled tasks are excluded; malformed dates do not enter deadline buckets. Dates are local date-only values. Switching identity or organization resets the view.

Uses the existing authorized snapshot; no database migrations, new access grants, provider changes or MeetingDesk modifications. Includes date-boundary, scope, escaping, navigation, empty-state and reset tests, plus a mobile browser scenario. Release through the existing GitHub Pages workflow after checks pass.

The preceding loading change remains: refresh and retry states live inside the content area while the shell stays mounted.

Remaining roadmap: recurring work, comments/@mentions and notifications, standalone milestones. Microsoft provider configuration and independent MeetingDesk acceptance remain outstanding.
