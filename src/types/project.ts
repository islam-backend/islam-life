export type ProjectStatus = 'active' | 'paused' | 'done'

export interface Project {
  id: string
  name: string
  status: ProjectStatus
  clientId: string
  clientName: string
  totalHours: number
  createdAt?: unknown
  createdBy?: string
}
