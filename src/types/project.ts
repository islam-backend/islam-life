export type ProjectStatus = 'active' | 'paused' | 'done'

export interface Project {
  id: string
  name: string
  status: ProjectStatus
  clientId: string
  clientName: string
  totalHours: number
  /** Sidebar sort position within its client (drag to reorder). */
  orderIndex?: number
  createdAt?: unknown
  createdBy?: string
}
