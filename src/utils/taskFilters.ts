import type { TaskPriority } from '../types/task'

/** Shared by ProjectTasksPage and AdminAllAssignmentsPage — the assignee
 * dropdown offers 'all' | 'unassigned' | a specific member uid. */
export function matchesAssigneeFilter(assigneeUids: string[] | undefined, filterValue: string): boolean {
  const uids = assigneeUids ?? []
  if (filterValue === 'all') return true
  if (filterValue === 'unassigned') return uids.length === 0
  return uids.includes(filterValue)
}

/** 'all' | 'none' | a specific priority. */
export function matchesPriorityFilter(priority: TaskPriority | null | undefined, filterValue: string): boolean {
  if (filterValue === 'all') return true
  if (filterValue === 'none') return !priority
  return priority === filterValue
}

/** 'all' | a specific tag label. */
export function matchesTagFilter(tags: string[] | undefined, filterValue: string): boolean {
  if (filterValue === 'all') return true
  return (tags ?? []).includes(filterValue)
}
