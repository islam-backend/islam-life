export type NoteSection = 'overview' | 'requirements' | 'decisions' | 'meeting' | 'links' | 'other'

export interface ProjectNote {
  id: string
  title: string
  /** Markdown. */
  content: string
  section: NoteSection
  pinned?: boolean
  createdAt?: unknown
  createdBy?: string
  createdByName?: string
  updatedAt?: unknown
  updatedByName?: string
}
