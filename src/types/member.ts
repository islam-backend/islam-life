export type MemberRole = 'owner' | 'manager' | 'member'

export interface AssignedProject {
  clientId: string
  clientName: string
  projectId: string
  projectName: string
}

export interface Member {
  uid: string
  email: string
  displayName: string
  role: MemberRole
  avatarUrl?: string
  avatarPath?: string
  fcmToken?: string | null
  fcmTokenUpdatedAt?: unknown
  totpEnrolled?: boolean
  /** Which projects a MEMBER can see at all in their sidebar — set/edited
   * by the owner, anytime, independent of individual task assignment.
   * Owner ignores this entirely (sees everything). */
  assignedProjects?: AssignedProject[]
  /** Same ids as `assignedProjects`, flat — the security rules can't search a
   * list of maps, so they check this one. Always written together with it. */
  assignedProjectIds?: string[]
  /** MEMBER only, granted by the owner/manager: may create tasks for
   * themselves (assigned to them alone) inside their assigned projects. */
  canCreateOwnTasks?: boolean
  /** MANAGER only — the clients this manager has full, owner-like control
   * over (create projects, create/assign/delete tasks, invite members).
   * Ignored for owner (sees everything) and plain members. */
  managedClientIds?: string[]
  /** Who invited this person (uid) and that inviter's role at the time —
   * copied from the invite when they first join, checked by firestore.rules.
   * Absent on members who joined before this existed (treated as the owner's). */
  invitedBy?: string
  invitedByRole?: MemberRole
  /** MANAGER only, set by the owner: may this manager also see the audit
   * log of people the OWNER invited? (Their own invitees they always see.) */
  auditSeesOwnerInvitees?: boolean
  createdAt?: unknown
  updatedAt?: unknown
}
