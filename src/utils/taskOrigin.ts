/**
 * Where a task was opened from — passed as router `state` on every link
 * into a task, so the task page can show "My Tasks / Client / Project / Task"
 * and link back to exactly that list (search/filters included).
 */
export interface TaskOrigin {
  label: string
  to: string
}

export function originState(label: string, to: string): { from: TaskOrigin } {
  return { from: { label, to } }
}

export function readOrigin(state: unknown): TaskOrigin | null {
  const from = (state as { from?: TaskOrigin } | null)?.from
  return from && typeof from.label === 'string' && typeof from.to === 'string' ? from : null
}
