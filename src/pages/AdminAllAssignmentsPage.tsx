import { useMemo, useState } from 'react'

import { AssignmentsTable } from '../components/admin/AssignmentsTable'
import { DEFAULT_TASK_FILTERS, FilterBar, type TaskFilters } from '../components/layout/FilterBar'
import { TopBar } from '../components/layout/TopBar'
import { useAllTasks } from '../hooks/useAllTasks'
import { useAuth } from '../hooks/useAuth'
import { useMembers } from '../hooks/useMembers'
import { isOwnerRole } from '../utils/role'
import {
  matchesAssigneeFilter,
  matchesPriorityFilter,
  matchesProjectFilter,
  matchesStatusFilter,
  matchesTagFilter,
} from '../utils/taskFilters'

export function AdminAllAssignmentsPage() {
  const { member } = useAuth()
  const isOwner = isOwnerRole(member?.role)
  const managedClientIds = member?.managedClientIds ?? []
  // Owner: every task. Manager: every task in the clients they manage.
  const { tasks } = useAllTasks(isOwner || managedClientIds.length > 0, isOwner ? undefined : managedClientIds)
  const { members } = useMembers()
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS)

  const allTags = useMemo(
    () => Array.from(new Set(tasks.flatMap((t) => t.tags ?? []))).sort(),
    [tasks]
  )

  const projects = useMemo(() => {
    const byId = new Map<string, string>()
    for (const t of tasks) {
      if (t.projectId && !byId.has(t.projectId)) {
        byId.set(t.projectId, `${t.clientName} / ${t.projectName}`)
      }
    }
    return Array.from(byId, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [tasks])

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (!matchesAssigneeFilter(t.assigneeUids, filters.assigneeUids)) return false
      if (!matchesStatusFilter(t.status, filters.statuses)) return false
      if (!matchesPriorityFilter(t.priority, filters.priorities)) return false
      if (!matchesTagFilter(t.tags, filters.tags)) return false
      if (!matchesProjectFilter(t.projectId, filters.projectIds)) return false
      if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false
      return true
    })
  }, [tasks, filters])

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'All Assignments' }]} />
      <FilterBar
        filters={filters}
        onChange={setFilters}
        members={members}
        showAssignee
        allTags={allTags}
        projects={projects}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <AssignmentsTable tasks={filtered} members={members} />
      </div>
    </>
  )
}
