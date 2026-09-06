import type { Member } from '../../types/member'
import type { TaskPriority, TaskStatus } from '../../types/task'
import { PRIORITY_META, PRIORITY_ORDER } from '../../utils/priority'

export type DueFilter = 'any' | 'overdue' | 'today' | 'week'

export interface TaskFilters {
  assigneeUid: string | 'all'
  status: TaskStatus | 'all'
  priority: TaskPriority | 'all' | 'none'
  tag: string | 'all'
  due: DueFilter
  search: string
}

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  assigneeUid: 'all',
  status: 'all',
  priority: 'all',
  tag: 'all',
  due: 'any',
  search: '',
}

const selectClass =
  'rounded-[7px] border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text-muted outline-none focus:border-accent'

export function FilterBar({
  filters,
  onChange,
  members,
  showAssignee,
  allTags = [],
}: {
  filters: TaskFilters
  onChange: (f: TaskFilters) => void
  members: Member[]
  showAssignee: boolean
  allTags?: string[]
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center justify-between gap-2.5 border-b border-border px-6 py-2.5">
      <div className="flex items-center gap-2">
        {showAssignee && (
          <select
            className={selectClass}
            value={filters.assigneeUid}
            onChange={(e) => onChange({ ...filters, assigneeUid: e.target.value })}
          >
            <option value="all">Assignee: All</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.displayName || m.email}
              </option>
            ))}
          </select>
        )}
        <select
          className={selectClass}
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value as TaskFilters['status'] })}
        >
          <option value="all">Status: All</option>
          <option value="backlog">Backlog</option>
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
        <select
          className={selectClass}
          value={filters.priority}
          onChange={(e) => onChange({ ...filters, priority: e.target.value as TaskFilters['priority'] })}
        >
          <option value="all">Priority: All</option>
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
          <option value="none">No priority</option>
        </select>
        {allTags.length > 0 && (
          <select
            className={selectClass}
            value={filters.tag}
            onChange={(e) => onChange({ ...filters, tag: e.target.value })}
          >
            <option value="all">Tag: All</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <select
          className={selectClass}
          value={filters.due}
          onChange={(e) => onChange({ ...filters, due: e.target.value as DueFilter })}
        >
          <option value="any">Due date: Any</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
        </select>
      </div>
      <input
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Search tasks"
        className="w-52 rounded-[7px] border border-border bg-surface px-3 py-1.5 text-[12.5px] text-text placeholder:text-text-faint outline-none focus:border-accent"
      />
    </div>
  )
}
