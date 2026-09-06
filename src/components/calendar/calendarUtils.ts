import type { Task } from '../../types/task'

export type DayStatus = 'green' | 'amber' | 'red'

export interface ClientDay {
  clientId: string
  clientName: string
  tasks: Task[]
  done: number
  status: DayStatus
}

/** Local 'YYYY-MM-DD' for a task's dueDate, or null when it has none. */
export function dueDayKey(task: Task): string | null {
  const d = (task.dueDate as { toDate?: () => Date } | null)?.toDate?.()
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

/** Tasks with a dueDate, keyed by local day. */
export function tasksByDay(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    const key = dueDayKey(t)
    if (!key) continue
    const arr = map.get(key)
    if (arr) arr.push(t)
    else map.set(key, [t])
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
