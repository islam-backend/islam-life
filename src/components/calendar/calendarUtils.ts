import type { Task } from '../../types/task'

export type DayStatus = 'green' | 'amber' | 'red'

export interface ClientDay {
  clientId: string
  clientName: string
  tasks: Task[]
  done: number
  status: DayStatus
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function toDate(v: unknown): Date | null {
  return (v as { toDate?: () => Date } | null)?.toDate?.() ?? null
}

/** Every local day a task occupies on the calendar. A task with both a
 * start and a due date spans the whole range (capped at 60 days); with
 * only one date it lands on that single day. */
export function taskDayKeys(task: Task): string[] {
  const a = toDate(task.startDate)
  const b = toDate(task.dueDate)
  if (!a && !b) return []
  let start = a ?? b!
  let end = b ?? a!
  if (start > end) [start, end] = [end, start]

  const keys: string[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  for (let i = 0; cur <= last && i < 60; i++) {
    keys.push(dayKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return keys
}

/**
 * Per client, per day:
 *   green  = every task that day is done
 *   amber  = some done, some not
 *   red    = tasks exist, none done
 */
export function groupByClient(tasks: Task[]): ClientDay[] {
  const byClient = new Map<string, ClientDay>()
  for (const t of tasks) {
    let g = byClient.get(t.clientId)
    if (!g) {
      g = { clientId: t.clientId, clientName: t.clientName, tasks: [], done: 0, status: 'red' }
      byClient.set(t.clientId, g)
    }
    g.tasks.push(t)
    if (t.status === 'done') g.done++
  }
  for (const g of byClient.values()) {
    g.status = g.done === g.tasks.length ? 'green' : g.done > 0 ? 'amber' : 'red'
  }
  return Array.from(byClient.values()).sort((a, b) => a.clientName.localeCompare(b.clientName))
}

/** Tasks keyed by local day — a ranged task appears under every day it spans. */
export function tasksByDay(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    for (const key of taskDayKeys(t)) {
      const arr = map.get(key)
      if (arr) arr.push(t)
      else map.set(key, [t])
    }
  }
  return map
}

/** The 6×7 grid of dates for the month containing `anchor` (weeks start Sunday). */
export function monthGridDays(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}
