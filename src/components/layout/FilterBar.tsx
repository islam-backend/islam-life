import type { Member } from '../../types/member'
import type { TaskStatus } from '../../types/task'
import { PRIORITY_META, PRIORITY_ORDER } from '../../utils/priority'
import { Select } from '../ui/Select'
import { FilterMenu } from './FilterMenu'

export type DueFilter = 'any' | 'overdue' | 'today' | 'week'

export interface TaskFilters {
  /** member uids, plus the sentinel 'unassigned' */
  assigneeUids: string[]
  statuses: TaskStatus[]
  /** priorities, plus the sentinel 'none' */
  priorities: string[]
  tags: string[]
  due: DueFilter
  search: string
}

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  assigneeUids: [],
  statuses: [],
  priorities: [],
  tags: [],
  due: 'any',
  search: '',
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]

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
  const anyActive =
    filters.assigneeUids.length ||
    filters.statuses.length ||
    filters.priorities.length ||
    filters.tags.length ||
    filters.due !== 'any' ||
    filters.search

  return (
    <div className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {showAssignee && (
          <FilterMenu
            label="Assignee"
            selected={filters.assigneeUids}
            onChange={(assigneeUids) => onChange({ ...filters, assigneeUids })}
            options={[
              { value: 'unassigned', label: 'Unassigned' },
              ...members.map((m) => ({ value: m.uid, label: m.displayName || m.email })),
            ]}
          />
        )}
        <FilterMenu
          label="Status"
          selected={filters.statuses}
          onChange={(statuses) => onChange({ ...filters, statuses: statuses as TaskStatus[] })}
          options={STATUS_OPTIONS}
        />
        <FilterMenu
          label="Priority"
          selected={filters.priorities}
          onChange={(priorities) => onChange({ ...filters, priorities })}
          options={[
            ...PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_META[p].label })),
            { value: 'none', label: 'No priority' },
          ]}
        />
        {allTags.length > 0 && (
          <FilterMenu
            label="Tags"
            selected={filters.tags}
            onChange={(tags) => onChange({ ...filters, tags })}
            options={allTags.map((t) => ({ value: t, label: t }))}
          />
        )}
        <Select
          size="sm"
          value={filters.due}
          onChange={(e) => onChange({ ...filters, due: e.target.value as DueFilter })}
        >
          <option value="any">Due: Any</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
        </Select>
        {anyActive && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_TASK_FILTERS)}
            className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-text-faint hover:text-text"
          >
            مسح الكل
          </button>
        )}
      </div>
      <input
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Search tasks"
        className="w-52 rounded-lg border border-border bg-field px-3 py-1.5 text-[12.5px] text-text placeholder:text-text-faint outline-none focus:border-accent"
      />
    </div>
  )
}
