import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { DEFAULT_TASK_FILTERS, FilterBar, type TaskFilters } from '../components/layout/FilterBar'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/Button'
import { NewTaskModal } from '../components/tasks/NewTaskModal'
import { TaskTable } from '../components/tasks/TaskTable'
import { useAuth } from '../hooks/useAuth'
import { useClientProject } from '../hooks/useClientProject'
import { useMembers } from '../hooks/useMembers'
import { useProjectTasks } from '../hooks/useProjectTasks'
import {
  matchesAssigneeFilter,
  matchesPriorityFilter,
  matchesStatusFilter,
  matchesTagFilter,
} from '../utils/taskFilters'
import { canManageClient } from '../utils/role'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function ProjectTasksPage() {
  const { clientId = '', projectId = '' } = useParams()
  const { member } = useAuth()
  const canManage = canManageClient(member, clientId)

  // Everyone (owner, manager, member) can read the client + project docs,
  // so fetch the breadcrumb names directly by id — uniform, and correct
  // even for a project a member reached purely through a task assignment
  // (not one of their granted `assignedProjects`).
  const direct = useClientProject(clientId, projectId)
  const clientProject =
    direct.clientName && direct.projectName
      ? { clientName: direct.clientName, projectName: direct.projectName }
      : null
  const notFound = direct.notFound

  const { members } = useMembers()
  const { tasks } = useProjectTasks(clientId, projectId, member, canManage)
  const [showNewTask, setShowNewTask] = useState(false)

  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS)

  // React Router keeps this page mounted when you switch projects, so
  // filters set on one project would silently carry over and hide
  // everything on the next. Reset them whenever the project changes.
  useEffect(() => {
    setFilters(DEFAULT_TASK_FILTERS)
  }, [clientId, projectId])

  const allTags = useMemo(
    () => Array.from(new Set(tasks.flatMap((t) => t.tags ?? []))).sort(),
    [tasks]
  )

  const filteredTasks = useMemo(() => {
    const today = startOfToday()
    const weekOut = new Date(today)
    weekOut.setDate(weekOut.getDate() + 7)

    return tasks.filter((t) => {
      if (!matchesAssigneeFilter(t.assigneeUids, filters.assigneeUids)) return false
      if (!matchesStatusFilter(t.status, filters.statuses)) return false
      if (!matchesPriorityFilter(t.priority, filters.priorities)) return false
      if (!matchesTagFilter(t.tags, filters.tags)) return false
      if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false

      if (filters.due !== 'any') {
        const due = (t.dueDate as { toDate?: () => Date } | null)?.toDate?.()
        if (!due) return false
        if (filters.due === 'overdue' && !(due < today && t.status !== 'done')) return false
        if (filters.due === 'today' && due.toDateString() !== today.toDateString()) return false
        if (filters.due === 'week' && !(due >= today && due <= weekOut)) return false
      }
      return true
    })
  }, [tasks, filters])

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-[13px] text-text-muted">This project doesn't exist (or you don't have access to it).</p>
        <Link to="/" className="text-[12.5px] font-medium text-accent hover:underline">
          Back home
        </Link>
      </div>
    )
  }

  if (!clientProject) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">Loading…</div>
  }

  return (
    <>
      <TopBar
        crumbs={[{ label: clientProject.clientName }, { label: clientProject.projectName }]}
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setShowNewTask(true)}>
              New Task
            </Button>
          ) : undefined
        }
      />
      <FilterBar
        filters={filters}
        onChange={setFilters}
        members={members}
        showAssignee={canManage}
        allTags={allTags}
      />
      <TaskTable tasks={filteredTasks} members={members} />

      {canManage && (
        <NewTaskModal
          open={showNewTask}
          onClose={() => setShowNewTask(false)}
          clientId={clientId}
          clientName={clientProject.clientName}
          projectId={projectId}
          projectName={clientProject.projectName}
          members={members}
          taskCount={tasks.length}
        />
      )}
    </>
  )
}
