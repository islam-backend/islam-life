import { useMemo, useState } from 'react'

import { AssignmentsTable } from '../components/admin/AssignmentsTable'
import { DEFAULT_TASK_FILTERS, FilterBar, type TaskFilters } from '../components/layout/FilterBar'
import { TopBar } from '../components/layout/TopBar'
import { useAllTasks } from '../hooks/useAllTasks'
import { useMembers } from '../hooks/useMembers'
import { matchesAssigneeFilter, matchesPriorityFilter, matchesTagFilter } from '../utils/taskFilters'

export function AdminAllAssignmentsPage() {
  const { tasks } = useAllTasks()
  const { members } = useMembers()
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS)

  const allTags = useMemo(
    () => Array.from(new Set(tasks.flatMap((t) => t.tags ?? []))).sort(),
    [tasks]
  )

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (!matchesAssigneeFilter(t.assigneeUids, filters.assigneeUid)) return false
      if (filters.status !== 'all' && t.status !== filters.status) return false
      if (!matchesPriorityFilter(t.priority, filters.priority)) return false
      if (!matchesTagFilter(t.tags, filters.tag)) return false
      if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false
      return true
    })
  }, [tasks, filters])

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'All Assignments' }]} />
      <FilterBar filters={filters} onChange={setFilters} members={members} showAssignee allTags={allTags} />
      <div className="flex-1 overflow-y-auto p-6">
        <AssignmentsTable tasks={filtered} members={members} />
      </div>
    </>
  )
}
