import type { Task } from '../../types/task'
import { Avatar } from '../ui/Avatar'
import { type ClientDay, dayKey, groupByClient, monthGridDays } from './calendarUtils'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function MonthGrid({
  month,
  tasksForDay,
  selectedKey,
  onSelectDay,
}: {
  month: Date
  tasksForDay: (key: string) => Task[]
  selectedKey: string | null
  onSelectDay: (key: string) => void
}) {
  const days = monthGridDays(month)
  const todayKey = dayKey(new Date())
  const thisMonth = month.getMonth()

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 bg-field">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date) => {
          const key = dayKey(date)
          const dayTasks = tasksForDay(key)
          const clientDays: ClientDay[] = groupByClient(dayTasks)
          const outside = date.getMonth() !== thisMonth
          const isToday = key === todayKey
          const selected = key === selectedKey

          return (
            <button
              key={key}
              onClick={() => onSelectDay(key)}
              className={`flex min-h-[92px] flex-col gap-1.5 border-b border-r border-border p-1.5 text-left transition-colors last:border-r-0 hover:bg-field ${
                outside ? 'opacity-40' : ''
              } ${selected ? 'bg-accent-tint/50' : ''}`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11.5px] ${
                  isToday ? 'bg-accent font-bold text-white' : 'text-text-muted'
                }`}
              >
                {date.getDate()}
              </span>
              <div className="flex flex-wrap gap-1">
                {clientDays.map((cd) => (
                  <span key={cd.clientId} title={`${cd.clientName} — ${cd.done}/${cd.tasks.length} done`}>
                    <Avatar name={cd.clientName} size={22} colorClass="bg-avatar-a" statusBorder={cd.status} />
                  </span>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
