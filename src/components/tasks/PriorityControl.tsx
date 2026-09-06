import type { TaskPriority } from '../../types/task'
import { PRIORITY_META, PRIORITY_ORDER } from '../../utils/priority'

export function PriorityControl({
  value,
  onChange,
  disabled,
}: {
  value: TaskPriority | null | undefined
  onChange: (p: TaskPriority | null) => void
  disabled?: boolean
}) {
  return (
    <select
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as TaskPriority | null)}
      className="w-fit rounded-full border-none bg-field py-1.5 pl-3 pr-8 text-[13px] font-medium text-text outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
    >
      <option value="">No priority</option>
      {PRIORITY_ORDER.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_META[p].label}
        </option>
      ))}
    </select>
  )
}
