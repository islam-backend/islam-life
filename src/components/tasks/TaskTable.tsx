import { useLocation } from 'react-router-dom'

import type { Task } from '../../types/task'
import { TASK_GRID, TaskRow } from './TaskRow'

const headerClass = 'text-[11.5px] font-semibold uppercase tracking-wide text-text-faint'

export function TaskTable({ tasks }: { tasks: Task[] }) {
  const location = useLocation()

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">
        No tasks match these filters yet.
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-6">
      <div className={`grid ${TASK_GRID} gap-3 px-5 pb-1`}>
        <span className={headerClass}>Task</span>
        <span className={headerClass}>Assignees</span>
        <span className={headerClass}>Priority</span>
        <span className={headerClass}>Status</span>
        <span className={headerClass}>Due</span>
        <span />
      </div>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} to={`${location.pathname}/tasks/${task.id}`} />
      ))}
    </div>
  )
}
