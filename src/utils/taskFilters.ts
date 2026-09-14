import type { TaskPriority, TaskStatus } from '../types/task'
import type { DueFilter } from '../components/layout/FilterBar'

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

export function matchesProjectFilter(projectId: string | undefined, selected: string[]): boolean {
  return selected.length === 0 || (!!projectId && selected.includes(projectId))
}

/**
 * Due-date filter shared across all task pages.
 *
 * "week" = the full current calendar week (Sunday → Saturday), so tasks
 * due earlier in the week (e.g., Monday when today is Friday) still show.
 * Previously it was "next 7 days from today" which made those tasks vanish.
 */
export function matchesDueFilter(dueDate: unknown, status: TaskStatus, due: DueFilter): boolean {
  if (due === 'any') return true

  const d = (dueDate as { toDate?: () => Date } | null)?.toDate?.()
  if (!d) return false

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (due === 'overdue') return d < today && status !== 'done'

  if (due === 'today') {
    // Compare local date parts so UTC-midnight stored dates work in any timezone
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    )
  }

  if (due === 'week') {
    // Full current calendar week: Sunday 00:00 → Saturday 23:59:59
    const sun = new Date(today)
    sun.setDate(today.getDate() - today.getDay()) // rewind to Sunday
    const sat = new Date(sun)
    sat.setDate(sun.getDate() + 6)
    sat.setHours(23, 59, 59, 999)
    return d >= sun && d <= sat
  }

  return true
}
