import { useMemo, useState } from 'react'
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
import { isOwnerRole } from '../utils/role'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function ProjectTasksPage() {
  const { clientId = '', projectId = '' } = useParams()
  const { member } = useAuth()
  const isOwner = isOwnerRole(member?.role)

  // A member already has the name denormalized on their own doc — no
  // extra read needed. The owner fetches just this one client + project
  // directly by id (fast, and correct regardless of what the sidebar's
  // broader tree has loaded so far).
  const assigned = member?.assignedProjects?.find((ap) => ap.projectId === projectId)
  const direct = useClientProject(isOwner ? clientId : '', isOwner ? projectId : '')

  const clientProject = isOwner
    ? direct.clientName && direct.projectName
      ? { clientName: direct.clientName, projectName: direct.projectName }
      : null
    : assigned
      ? { clientName: assigned.clientName, projectName: assigned.projectName }
      : null

  const notFound = isOwner ? direct.notFound : !isOwner && !!member && !assigned

  const { members } = useMembers()
  const { tasks } = useProjectTasks(clientId, projectId, member)
  const [showNewTask, setShowNewTask] = useState(false)

  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS)

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
          isOwner ? (
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
        showAssignee={isOwner}
        allTags={allTags}
      />
      <TaskTable tasks={filteredTasks} />

      {isOwner && (
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
