export type FocusPreset = 'quick' | 'intense' | 'deep' | 'custom'

export interface FocusSession {
  id: string
  uid: string
  presetType: FocusPreset
  workMinutes: number
  breakMinutes: number
  projectId?: string
  projectName?: string
  clientId?: string
  clientName?: string
  taskId?: string
  taskTitle?: string
  startedAt?: unknown
  completedAt?: unknown
  hours: number
  source: 'timer' | 'manual'
  createdAt?: unknown
}
