export type MemberRole = 'owner' | 'member'

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
  createdAt?: unknown
  updatedAt?: unknown
}
