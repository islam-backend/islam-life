import type { TaskStatus } from '../types/task'

/** Workflow order — "next stage" means the next entry here. */
export const STATUS_ORDER: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done']

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
}

export function nextStatus(status: TaskStatus): TaskStatus | null {
  const i = STATUS_ORDER.indexOf(status)
  return i >= 0 && i < STATUS_ORDER.length - 1 ? STATUS_ORDER[i + 1] : null
}
