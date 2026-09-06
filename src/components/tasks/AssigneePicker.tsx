import type { Member } from '../../types/member'
import type { TaskAssignee } from '../../types/task'
import { memberToAssignee } from '../../utils/assignees'
import { Avatar } from '../ui/Avatar'

/** Multi-select assignee picker — a task can have more than one person on it. */
export function AssigneePicker({
  value,
  members,
  onChange,
  disabled,
}: {
  value: TaskAssignee[]
  members: Member[]
  onChange: (assignees: TaskAssignee[]) => void
  disabled?: boolean
}) {
  const selectedUids = new Set(value.map((a) => a.uid))

  function toggle(m: Member) {
    if (disabled) return
    onChange(
      selectedUids.has(m.uid)
        ? value.filter((a) => a.uid !== m.uid)
        : [...value, memberToAssignee(m)]
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => {
        const on = selectedUids.has(m.uid)
        return (
          <button
            key={m.uid}
            type="button"
            disabled={disabled}
            onClick={() => toggle(m)}
            className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-60 ${
              on
                ? 'bg-accent-tint text-accent-tint-text'
                : 'bg-field text-text-muted hover:text-text'
            }`}
          >
            <Avatar name={m.displayName || m.email} imageUrl={m.avatarUrl} size={18} colorClass="bg-avatar-b" />
            {m.displayName || m.email}
          </button>
        )
      })}
      {members.length === 0 && <span className="text-[12.5px] text-text-faint">No team members yet</span>}
    </div>
  )
}
