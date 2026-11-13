# Planning, workload, and vendor tracking

## Time frames and effort

Task and milestone forms have a **Time frame & effort** section. Fixed task dates may remain blank. Milestones retain a target deadline. Hours describe hands-on effort; calendar-day duration describes elapsed time. Milestone estimated hours are a budget, compared with linked task estimates, and never added to staff workload.

Tasks may use fixed dates, **Use milestone deadline**, an offset from the milestone target, or an offset from the project target. Milestones can follow the project target. Relative durations include both endpoints: five days ending Friday start Monday. Negative offsets finish before the anchor. Linked open work follows anchor changes; completed and cancelled tasks are not moved automatically. An inherited milestone deadline is explicitly selected rather than silently filling a blank deadline.

The task form displays the selected milestone's start and finish and constrains its date inputs. Database checks enforce the final transaction state: open task dates cannot be outside the milestone's recorded start/finish. A milestone without a start imposes only an end boundary. Shrinking a milestone around fixed child dates is rejected; adjust children or expand the milestone first. Existing historical rows are not rewritten by migration. Old conflicts must be corrected when their schedules change.

## Weekly workload

Dashboard → **Workload planner** → **Weekly effort & capacity** shows daily hours for a selected week, project, and person. Estimates are spread evenly over each task's working days. Remaining hours, when supplied, supersede estimated hours and start no earlier than today for future work. A task with only a finish date is allocated on that working day. Weekend-only schedules with no configured working day are flagged as unscheduled.

The forecast includes visible open managed work, not time sheets or a resource-leveled delivery prediction. Missing estimates, unscheduled hours, and overdue work remain visible and must not be interpreted as free time. Staff can be selected for task detail; weekly CSV export preserves the chosen view.

## Scoped settings

**Control panel** provides organization defaults, department overrides, and project overrides for capacity, default new-task hours, default relative duration, and working days. Blank values inherit. Each field shows its effective value and source. Existing task estimates are not rewritten. Organization admins edit organization settings; department managers and project leads edit their authorized scopes. Changes use revisions to reject stale saves.

Default capacity is 40 hours/week; reduce it to reserve time for support, meetings, leave, and interruptions. Individual capacity overrides are set by organization admins in the workload table and apply organization-wide. Capacity values are readable by active organization members so managers see consistent forecasts. Project capacity applies to the project-specific view; the all-project view uses organization/selected-department capacity. Different project capacities are not added together.

## Invited owners

Eligible pending invitations appear in task assignee menus as **invited / tracking only**. These assignments carry estimates and workload without creating accounts, granting access, or making invitees reviewers. Organization, department, and project invitation scopes are checked against the task's project. Once the person accepts and independently receives appropriate project access (and restricted-task participation when applicable), open assignments reconcile to the real account. Existing individual user capacity overrides take precedence over migrated invitation capacity. Revoked invitations cannot receive new assignments; existing tracking records remain identifiable.

## Vendors and follow-up

Control panel → **Vendors & contacts** stores a shared organization business-contact directory. Organization admins, department managers, and project leads may maintain it. Vendors and contacts can be archived while retaining historical links. No messages or invitations are sent by this feature.

Task and milestone forms can mark work **Vendor dependent** and record the vendor, a contact at that vendor, ticket/order reference, last contacted date, next follow-up date, and notes. The directory also lists visible vendor-dependent work by next follow-up, flags overdue follow-ups, and links to the source task/milestone. Contacts and vendors cannot cross organization boundaries. Vendor details appear in task/milestone views and HTML project/staff reports. Task planning/vendor edits generate task history events.

## Report semantics

**Blocked** means explicitly marked Blocked. **Waiting for prerequisites** is separate, normal sequencing and does not by itself worsen project health. Tasks explicitly blocked are counted in Blocked even if they also have unfinished prerequisites, avoiding duplicate exception counts. Task registers still show prerequisite context. Delivery timelines show due-date points and bars only when recorded start dates exist; they do not invent durations.

## Validation and deployment

Apply `20261113122851_questboard_planning_capacity_settings.sql` before publishing the frontend. It adds fields/tables/functions and policies without rewriting existing tasks or modifying unrelated MeetingDesk tables. Tests cover schedule resolution and propagation, atomic creation, milestone bounds, settings revisions and inheritance, invited-owner reconciliation, vendor isolation, role enforcement, workload calculations, report distinctions, form submission, and populated-schema preservation.
