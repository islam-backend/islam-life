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
    <div className="inline-flex w-fit flex-wrap gap-0.5 rounded-lg bg-field p-1">
      <button
        disabled={disabled}
        onClick={() => onChange(null)}
        className={`cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          !value ? 'bg-surface text-text' : 'text-text-muted hover:text-text'
        }`}
      >
        No priority
      </button>
      {PRIORITY_ORDER.map((p) => (
        <button
          key={p}
          disabled={disabled}
          onClick={() => onChange(p)}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            value === p ? `${PRIORITY_META[p].bg} ${PRIORITY_META[p].text}` : 'text-text-muted hover:text-text'
          }`}
        >
          {PRIORITY_META[p].label}
        </button>
      ))}
    </div>
  )
}
