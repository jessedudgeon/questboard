# Session 13 — self-service signup and organization setup

Signup uses the existing enabled Google OAuth provider. The deployed Auth settings allow signup; Microsoft remains disabled. The login screen now offers Sign up with an explanation of the three-step flow. New users can create their own organization or accept existing invitations. Signed-in users can create additional organizations from the organization selector, regardless of their role in their current organization.

Creation calls qb_create_organization(name, request UUID). Its public function is security invoker; a private security-definer implementation checks the caller's verified auth.users email, validates the name, serializes attempts per caller and atomically creates the organization, active admin membership and private request receipt. Requests are identity-scoped and repeat calls with the same ID return the same organization only while the caller is still an active administrator. No direct organization/member insert grants were added. Existing membership auditing records bootstrap, and existing last-admin protections remain active.

After creation, the app selects the organization and opens first-department setup in Administration. Existing department insert RLS permits only active organization administrators. Additional departments and invitations remain available there. Errors preserve the organization form and request ID; duplicate clicks are disabled. A late response cannot restore a signed-out or switched account. A successful create followed by a failed workspace load uses the normal workspace retry path.

Migration: 20261103151939_questboard_self_service_organizations.sql. Apply once after isolated database and CI validation, before deploying the UI. Verify routine privileges and run security advisors. No MeetingDesk schema or shared authentication settings changed.

Validation includes database verification/role/isolation/replay tests, UI error/deduplication/sign-out tests, native PostgreSQL concurrent retry tests and a mobile browser organization-to-department scenario. Google provider registration itself uses the existing production OAuth setup; no synthetic production accounts or test organizations are created.

Remaining roadmap: recurring work, comments/@mentions, notifications and standalone milestones. Microsoft provider configuration and independent MeetingDesk acceptance remain outstanding.
