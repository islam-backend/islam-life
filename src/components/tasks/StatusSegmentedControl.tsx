import type { TaskStatus } from '../../types/task'

const options: { value: TaskStatus; label: string; activeClass: string }[] = [
  { value: 'backlog', label: 'Backlog', activeClass: 'bg-violet-tint text-violet-tint-text' },
  { value: 'todo', label: 'To Do', activeClass: 'bg-accent-tint text-accent-tint-text' },
  { value: 'in_progress', label: 'In Progress', activeClass: 'bg-amber-tint text-amber-tint-text' },
  { value: 'done', label: 'Done', activeClass: 'bg-green-tint text-green-tint-text' },
]

export function StatusSegmentedControl({
  value,
  onChange,
}: {
  value: TaskStatus
  onChange: (status: TaskStatus) => void
}) {
  return (
    <div className="inline-flex w-fit gap-0.5 rounded-lg bg-field p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            value === opt.value ? opt.activeClass : 'text-text-muted hover:text-text'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
