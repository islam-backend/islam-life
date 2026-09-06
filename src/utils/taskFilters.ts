import type { TaskPriority } from '../types/task'

// All matchers take an array of selected values. Empty = no filter (match
// everything); otherwise a task matches if it satisfies ANY selected value.

/** Selected values are member uids, plus the sentinel 'unassigned'. */
export function matchesAssigneeFilter(assigneeUids: string[] | undefined, selected: string[]): boolean {
  if (selected.length === 0) return true
  const uids = assigneeUids ?? []
  return selected.some((s) => (s === 'unassigned' ? uids.length === 0 : uids.includes(s)))
}

export function matchesStatusFilter(status: string, selected: string[]): boolean {
  return selected.length === 0 || selected.includes(status)
}

/** Selected values are priorities, plus the sentinel 'none'. */
export function matchesPriorityFilter(priority: TaskPriority | null | undefined, selected: string[]): boolean {
  if (selected.length === 0) return true
  return selected.some((s) => (s === 'none' ? !priority : priority === s))
}

export function matchesTagFilter(tags: string[] | undefined, selected: string[]): boolean {
  if (selected.length === 0) return true
  const t = tags ?? []
  return selected.some((s) => t.includes(s))
}
