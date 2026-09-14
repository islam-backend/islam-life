export interface Client {
  id: string
  name: string
  archived: boolean
  orderIndex?: number
  /** Small inline image (data URL) shown in the calendar. */
  avatarUrl?: string
  createdAt?: unknown
  createdBy?: string
}
