import type { TaskStatus } from '../../types/task'

const config: Record<TaskStatus, { label: string; dot: string; bg: string; text: string }> = {
  backlog: { label: 'Backlog', dot: 'bg-violet', bg: 'bg-violet-tint', text: 'text-violet-tint-text' },
  todo: { label: 'To Do', dot: 'bg-accent', bg: 'bg-accent-tint', text: 'text-accent-tint-text' },
  in_progress: { label: 'In Progress', dot: 'bg-amber', bg: 'bg-amber-tint', text: 'text-amber-tint-text' },
  done: { label: 'Done', dot: 'bg-green', bg: 'bg-green-tint', text: 'text-green-tint-text' },
}

const fallback = { label: 'Unknown', dot: 'bg-text-faint', bg: 'bg-field', text: 'text-text-muted' }

// `status` is typed as TaskStatus, but this renders real Firestore data —
// including older documents that predate this schema — so it must not
// crash the whole page on a value outside the four we know about.
export function StatusPill({ status }: { status: TaskStatus }) {
  const normalized = (status || '').toString().toLowerCase() as TaskStatus
  const c = config[normalized] ?? { ...fallback, label: status || fallback.label }
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${c.bg} ${c.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}
