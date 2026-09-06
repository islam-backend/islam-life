import type { TaskPriority } from '../../types/task'
import { Select } from '../ui/Select'
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
    <Select
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as TaskPriority | null)}
    >
      <option value="">No priority</option>
      {PRIORITY_ORDER.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_META[p].label}
        </option>
      ))}
    </Select>
  )
}
