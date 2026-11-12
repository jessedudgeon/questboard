# Project report exports

Open **Export project report** on a project, or **Reports → Export project reports**.
Choose one project or all matching projects and select:

- **Executive status:** progress, current target, schedule exceptions, milestone timeline, next steps, risks, decisions, and latest accomplishments.
- **Schedule & milestones:** the same management summary with task deadlines included in the timeline.
- **Detailed project report:** the schedule report plus a task register and complete visible project check-in history.

Use **Print / Save PDF** to open the browser print dialog and select Save as PDF. **Download report (HTML)** creates a self-contained document with embedded vector charts and print styling. Exported copies do not inherit application access controls.

Reports obey project access, workspace/search filters, and the include-closed setting. A project-specific entry clears global search so the selected project is available. An out-of-filter selection produces an explicit empty report rather than silently exporting a different project.

## Reading dates and charts

Project target and latest dated outstanding work are separate. Neither is a calculated completion forecast. Missing dates, overdue work, dependencies, and milestone evidence gaps are called out. Milestones without linked completion evidence require verification. Task-count completion excludes cancelled tasks and does not estimate effort.

Timeline points show recorded due dates, not actual completion dates or task duration. Colours distinguish targets, milestones, open tasks, blocked tasks, and completed work. A dashed line marks the report date. Large schedules split into chart blocks with the same scale. Undated items are counted separately. Reports use the generating browser's dates and locale.

The site does not yet store planned task start dates, effort estimates, or a separately maintained expected finish date. Genuine Gantt duration bars and reliable calculated finish forecasts require those inputs. Teams Planner is not synchronized.

## Validation

213 automated tests passed, including scope boundaries, escaping, deadline interpretation, unknown milestone completion, long timelines, report selection/reset, and the board status controls. Browser preview verified report selection, timeline layout, and HTML download. PDF output uses browser printing; a saved PDF was not separately rendered for verification.
