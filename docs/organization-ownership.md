# Organization ownership and membership removal

Open **Team → Departments → Manage members** (also available through the scope selector in Administration). Members load automatically when you enter either page. Choose the organization, department, or project to manage. Department ownership is the **Department owner / manager** role.

The Team roster includes organization members even without a department, plus pending invitations. Expired invitations remain visible with a replacement-invite action. Add team member creates an invitation and returns to the roster; copy its link to share it manually. Pending people have no access until acceptance and cannot be appointed organization owners until they join. The signed-in email and authority appear beside the controls to distinguish accounts with the same display name.

- An organization **owner** can promote an active member to Owner or change another owner's role. Multiple owners are supported. To transfer control, promote the replacement first, then change your own role to Administrator or Member.
- An **administrator** manages ordinary organization members and scoped leadership, but cannot appoint, demote, suspend or remove owners.
- Department managers and project leads retain their existing scoped authority over ordinary members. Leadership changes require organization administration.
- Select **Remove from organization/department/project**, check the named removal confirmation, then Apply. Suspension remains available when access should be paused temporarily. Owners must first relinquish ownership before suspension.
- At least one active owner must remain. Existing last-administrator, last-department-manager and restricted-project management safeguards remain enforced. Appoint a replacement manager before removing the last one.

Organization removal deletes its organization, department, project and task-participant access rows and revokes pending invitations in that organization. Department removal clears department membership, child project memberships and task-participant access, and revokes pending department/child-project invitations. Project removal clears explicit project membership and task participation. Independent department access or organization administrator authority can still grant project access.

Removal preserves tasks, journal entries, completed work, assignments, XP, wallet history and membership audit history. Existing assignments are retained for tracking; reassign open work as needed. Pending/approved reward redemptions are cancelled and reservations released on organization removal. Earned balances and fulfilled rewards remain recorded. Other organizations and the person's sign-in account are unaffected. Rejoining requires a new invitation or scoped access grant; previous scoped access is not restored automatically.

Implementation: ownership is an `is_owner` flag on an active admin membership, so existing authorization and reward eligibility rules remain compatible. The scoped directory presents it as the Owner role. Existing active organization admins are initialized as owners during the upgrade, preserving their previous control; future organization creators become owners automatically. Other ownership grants are explicit. The migration does not remove any real membership.

Membership writes serialize on the organization row. The RPC checks authority and expected role/status, guards the last owner, and writes the existing immutable audit stream. The prior lifecycle implementation is private with client execute revoked. Direct client writes to organization membership remain prohibited. Removing and then re-inviting a person does not delete their work or grant old scoped access.

## Department management

Every visible department has a card, including departments with no members.
Authorized managers can open its directory directly; choosing a department
workspace and entering Team loads that department automatically. The panel names
the selected department and shows the signed-in account.

Use **Add an organization member to this department** and **Add to department**
to grant access to an active, joined organization member. Choose Contributor,
Viewer, or (for organization administrators) Department owner / manager.
Existing members support role changes, suspension/reinstatement, and confirmed
removal. Administrators can use **Invite someone new to this department** for
a new person; the invitation starts with department Contributor selected.
Pending invitees remain visible in the Team roster and gain access on acceptance.
