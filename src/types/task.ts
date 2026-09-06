export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done'

/** How urgent the task is — independent of workflow status. `null`/absent = "no priority". */
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'

export interface TaskAssignee {
  uid: string
  email: string
  displayName: string
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  /** Every person working on this task. Replaces the old single `assignedTo`. */
  assignees: TaskAssignee[]
  /** Just the uids from `assignees` — a flat array so Firestore can run
   * `where('assigneeUids', 'array-contains', uid)` (it can't do that on an
   * array of maps). Always kept in sync with `assignees` on every write. */
  assigneeUids: string[]
  priority?: TaskPriority | null
  /** Free-form colored labels, à la Notion multi-select. */
  tags?: string[]
  /** Optional start of the task's window; `dueDate` is its end. */
  startDate?: unknown | null
  dueDate: unknown | null
  clientId: string
  clientName: string
  projectId: string
  projectName: string
  orderIndex: number
  hoursLogged: number
  createdAt?: unknown
  createdBy?: string
  updatedAt?: unknown
}
