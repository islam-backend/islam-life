import { Link } from 'react-router-dom'

import type { Task } from '../../types/task'
import { Avatar } from '../ui/Avatar'
import { StatusPill } from '../ui/StatusPill'
import { PriorityPill } from './PriorityPill'
import { TagList } from './TagList'

export const TASK_GRID = 'grid-cols-[1fr_150px_110px_120px_100px_28px]'

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-text-faint">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function formatDue(dueDate: unknown): { label: string; overdue: boolean } {
  if (!dueDate || typeof (dueDate as { toDate?: () => Date }).toDate !== 'function') {
    return { label: '—', overdue: false }
  }
  const date = (dueDate as { toDate: () => Date }).toDate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdue = date < today
  return { label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), overdue }
}

export function TaskRow({ task, to }: { task: Task; to: string }) {
  const due = formatDue(task.dueDate)

  return (
    <Link
      to={to}
      className={`grid ${TASK_GRID} items-center gap-3 rounded-lg border border-border bg-surface px-5 py-3.5 transition-colors hover:bg-field`}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[13.5px] text-text">{task.title}</span>
        <TagList tags={task.tags} />
      </span>
      {(task.assignees ?? []).length > 0 ? (
        <span className="flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {(task.assignees ?? []).slice(0, 3).map((a) => (
              <span key={a.uid} className="rounded-full ring-2 ring-surface">
                <Avatar name={a.displayName} size={22} colorClass="bg-avatar-b" />
              </span>
            ))}
          </span>
          <span className="truncate text-[12.5px] text-text-muted">
            {(task.assignees ?? []).length === 1
              ? task.assignees[0].displayName
              : `${task.assignees.length} people`}
          </span>
        </span>
      ) : (
        <span className="text-[12.5px] text-text-faint">Unassigned</span>
      )}
      <PriorityPill priority={task.priority} />
      <StatusPill status={task.status} />
      <span className={`text-[12.5px] ${due.overdue && task.status !== 'done' ? 'font-semibold text-red' : 'text-text-muted'}`}>
        {due.label}
      </span>
      <ChevronRight />
    </Link>
  )
}
