import { useMemo } from 'react'

import { TopBar } from '../components/layout/TopBar'
import { TASK_GRID, TaskRow } from '../components/tasks/TaskRow'
import { useAuth } from '../hooks/useAuth'
import { useMyTasks } from '../hooks/useMyTasks'
import type { Task } from '../types/task'

const headerClass = 'text-[11.5px] font-semibold uppercase tracking-wide text-text-faint'

interface Group {
  projectId: string
  clientName: string
  projectName: string
  clientId: string
  tasks: Task[]
}

function dueMillis(t: Task): number {
  const d = (t.dueDate as { toDate?: () => Date } | null)?.toDate?.()
  return d ? d.getTime() : Number.POSITIVE_INFINITY
}

/**
 * Every task assigned to me, across every project — regardless of which
 * projects the owner has granted me in the sidebar. This is the one place
 * that always shows the full picture of my work.
 */
export function MyTasksPage() {
  const { user } = useAuth()
  const { tasks, loading } = useMyTasks(user?.uid)

  const groups = useMemo<Group[]>(() => {
    const byProject = new Map<string, Group>()
    for (const t of tasks) {
      if (!byProject.has(t.projectId)) {
        byProject.set(t.projectId, {
          projectId: t.projectId,
          clientId: t.clientId,
          clientName: t.clientName,
          projectName: t.projectName,
          tasks: [],
        })
      }
      byProject.get(t.projectId)!.tasks.push(t)
    }
    const list = Array.from(byProject.values())
    for (const g of list) {
      g.tasks.sort((a, b) => dueMillis(a) - dueMillis(b) || a.title.localeCompare(b.title))
    }
    return list.sort((a, b) =>
      `${a.clientName}/${a.projectName}`.localeCompare(`${b.clientName}/${b.projectName}`)
    )
  }, [tasks])

  return (
    <>
      <TopBar crumbs={[{ label: 'My Tasks' }]} />
      <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">
            No tasks assigned to you yet.
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.projectId} className="flex flex-col gap-2.5">
              <h2 className="px-5 text-[12.5px] font-semibold text-text-muted">
                {g.clientName} <span className="text-text-faint">/</span> {g.projectName}
              </h2>
              <div className={`grid ${TASK_GRID} gap-3 px-5 pb-1`}>
                <span className={headerClass}>Task</span>
                <span className={headerClass}>Assignees</span>
                <span className={headerClass}>Priority</span>
                <span className={headerClass}>Status</span>
                <span className={headerClass}>Due</span>
                <span />
              </div>
              {g.tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  to={`/clients/${t.clientId}/projects/${t.projectId}/tasks/${t.id}`}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </>
  )
}
