import type { TaskPriority } from '../../types/task'
import { PRIORITY_META } from '../../utils/priority'

export function PriorityPill({ priority }: { priority: TaskPriority | null | undefined }) {
  if (!priority || !PRIORITY_META[priority]) {
    return <span className="text-[12px] text-text-faint">—</span>
  }
  const c = PRIORITY_META[priority]
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${c.bg} ${c.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}
