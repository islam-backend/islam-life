import { serverTimestamp, updateDoc } from 'firebase/firestore'
import { Link } from 'react-router-dom'

import { AssigneePicker } from '../tasks/AssigneePicker'
import { PriorityPill } from '../tasks/PriorityPill'
import { TagList } from '../tasks/TagList'
import { StatusPill } from '../ui/StatusPill'
import { taskDocRef } from '../../lib/firebase/refs'
import type { Member } from '../../types/member'
import type { Task, TaskAssignee } from '../../types/task'
import { assigneeFields } from '../../utils/assignees'

const GRID = 'grid-cols-[1.3fr_0.8fr_0.8fr_240px_110px_110px_90px]'

function formatDue(dueDate: unknown): { label: string; overdue: boolean } {
  const d = (dueDate as { toDate?: () => Date } | null)?.toDate?.()
  if (!d) return { label: '—', overdue: false }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return { label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), overdue: d < today }
}

const headerClass = 'text-[11.5px] font-semibold uppercase tracking-wide text-text-faint'

export function AssignmentsTable({ tasks, members }: { tasks: Task[]; members: Member[] }) {
  async function setAssignees(task: Task, assignees: TaskAssignee[]) {
    await updateDoc(taskDocRef(task.clientId, task.projectId, task.id), {
      ...assigneeFields(assignees),
      updatedAt: serverTimestamp(),
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className={`grid ${GRID} gap-3 bg-field px-5 py-2.5`}>
        <span className={headerClass}>Task</span>
        <span className={headerClass}>Client</span>
        <span className={headerClass}>Project</span>
        <span className={headerClass}>Assignees</span>
        <span className={headerClass}>Priority</span>
        <span className={headerClass}>Status</span>
        <span className={headerClass}>Due</span>
      </div>

      {tasks.map((task, i) => {
        const due = formatDue(task.dueDate)
        return (
          <div
            key={task.id}
            className={`grid ${GRID} items-center gap-3 px-5 py-3 ${
              i > 0 ? 'border-t border-border' : ''
            } ${(task.assigneeUids ?? []).length === 0 ? 'bg-[oklch(35%_0.05_25)]' : ''}`}
          >
            <span className="flex min-w-0 flex-col gap-1">
              <Link
                to={`/clients/${task.clientId}/projects/${task.projectId}/tasks/${task.id}`}
                className="truncate text-[13px] font-medium text-text hover:text-accent"
              >
                {task.title}
              </Link>
              <TagList tags={task.tags} />
            </span>
            <span className="truncate text-[13px] text-text-muted">{task.clientName}</span>
            <span className="truncate text-[13px] text-text-muted">{task.projectName}</span>
            <AssigneePicker
              value={task.assignees ?? []}
              members={members}
              onChange={(a) => setAssignees(task, a)}
            />
            <PriorityPill priority={task.priority} />
            <StatusPill status={task.status} />
            <span className={`text-[12.5px] ${due.overdue && task.status !== 'done' ? 'font-semibold text-red' : 'text-text-muted'}`}>
              {due.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
