import type { Task } from '../../types/task'
import { Avatar } from '../ui/Avatar'
import { type ClientDay, type DayStatus, dayKey, groupByClient, monthGridDays } from './calendarUtils'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const RING: Record<DayStatus, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
}
const MAX_AVATARS = 5

export function MonthGrid({
  month,
  tasksForDay,
  clientAvatar,
  selectedKey,
  onSelectDay,
}: {
  month: Date
  tasksForDay: (key: string) => Task[]
  clientAvatar: (clientId: string) => string | undefined
  selectedKey: string | null
  onSelectDay: (key: string) => void
}) {
  const days = monthGridDays(month)
  const todayKey = dayKey(new Date())
  const thisMonth = month.getMonth()

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-field">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date, i) => {
          const key = dayKey(date)
          const clientDays: ClientDay[] = groupByClient(tasksForDay(key))
          const outside = date.getMonth() !== thisMonth
          const isToday = key === todayKey
          const selected = key === selectedKey
          const shown = clientDays.slice(0, MAX_AVATARS)
          const extra = clientDays.length - shown.length

          return (
            <button
              key={key}
              onClick={() => onSelectDay(key)}
              className={`flex min-h-[104px] flex-col gap-2 overflow-hidden border-b border-border p-2 text-left transition-colors hover:bg-field ${
                i % 7 !== 6 ? 'border-r' : ''
              } ${outside ? 'bg-field/30 text-text-faint' : ''} ${selected ? 'bg-accent-tint/40' : ''}`}
            >
              <span
                className={`inline-flex h-[18px] min-w-[18px] items-center justify-center self-start rounded-full px-1 text-[11.5px] font-medium ${
                  isToday ? 'bg-accent text-white' : outside ? 'text-text-faint' : 'text-text-muted'
                }`}
              >
                {date.getDate()}
              </span>

              {clientDays.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {shown.map((cd) => (
                    <span
                      key={cd.clientId}
                      title={`${cd.clientName} — ${cd.done}/${cd.tasks.length} done`}
                      className="inline-flex rounded-full"
                      style={{ boxShadow: `0 0 0 2px ${RING[cd.status]}` }}
                    >
                      <Avatar
                        name={cd.clientName}
                        imageUrl={clientAvatar(cd.clientId)}
                        size={20}
                        colorClass="bg-avatar-a"
                      />
                    </span>
                  ))}
                  {extra > 0 && (
                    <span className="text-[10.5px] font-semibold text-text-faint">+{extra}</span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
