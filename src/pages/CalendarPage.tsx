import { serverTimestamp, updateDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { MonthGrid } from '../components/calendar/MonthGrid'
import { groupByClient, tasksByDay } from '../components/calendar/calendarUtils'
import { TopBar } from '../components/layout/TopBar'
import { StatusPill } from '../components/ui/StatusPill'
import { useCalendarTasks } from '../hooks/useCalendarTasks'
import { taskDocRef } from '../lib/firebase/refs'

function monthLabel(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function prettyDay(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function CalendarPage() {
  const { tasks, loading } = useCalendarTasks()
  const [month, setMonth] = useState(() => new Date())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const byDay = useMemo(() => tasksByDay(tasks), [tasks])
  const selectedGroups = selectedKey ? groupByClient(byDay.get(selectedKey) ?? []) : []

  async function markDone(clientId: string, projectId: string, taskId: string) {
    await updateDoc(taskDocRef(clientId, projectId, taskId), {
      status: 'done',
      updatedAt: serverTimestamp(),
    })
  }

  return (
    <>
      <TopBar
        crumbs={[{ label: 'Calendar' }, { label: monthLabel(month) }]}
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="cursor-pointer rounded-md px-2 py-1 text-[13px] text-text-muted hover:bg-field hover:text-text"
            >
              ‹
            </button>
            <button
              onClick={() => setMonth(new Date())}
              className="cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] font-medium text-text-muted hover:bg-field hover:text-text"
            >
              Today
            </button>
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="cursor-pointer rounded-md px-2 py-1 text-[13px] text-text-muted hover:bg-field hover:text-text"
            >
              ›
            </button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">Loading…</div>
          ) : (
            <>
              <MonthGrid
                month={month}
                tasksForDay={(key) => byDay.get(key) ?? []}
                selectedKey={selectedKey}
                onSelectDay={setSelectedKey}
              />
              <div className="mt-4 flex items-center gap-4 text-[11.5px] text-text-faint">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: 'var(--green)' }} /> كله خلص
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: 'var(--amber)' }} /> بعضه خلص
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: 'var(--red)' }} /> مفيش حاجة خلصت
                </span>
              </div>
            </>
          )}
        </div>

        {selectedKey && (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-border p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-text">{prettyDay(selectedKey)}</h2>
              <button
                onClick={() => setSelectedKey(null)}
                className="cursor-pointer text-[12px] text-text-faint hover:text-text"
              >
                إغلاق
              </button>
            </div>

            {selectedGroups.length === 0 ? (
              <p className="text-[12.5px] text-text-faint">مفيش تاسكات مجدولة في اليوم ده.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {selectedGroups.map((g) => (
                  <div key={g.clientId} className="flex flex-col gap-2">
                    <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
                      {g.clientName} · {g.done}/{g.tasks.length}
                    </span>
                    {g.tasks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                      >
                        <Link
                          to={`/clients/${t.clientId}/projects/${t.projectId}/tasks/${t.id}`}
                          className="min-w-0 flex-1 truncate text-[12.5px] text-text hover:text-accent"
                        >
                          {t.title}
                        </Link>
                        <StatusPill status={t.status} />
                        {t.status !== 'done' && (
                          <button
                            onClick={() => markDone(t.clientId, t.projectId, t.id)}
                            title="تحويل لـ Done"
                            className="shrink-0 cursor-pointer rounded-md bg-green-tint px-2 py-1 text-[11px] font-semibold text-green-tint-text"
                          >
                            ✓
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </>
  )
}
