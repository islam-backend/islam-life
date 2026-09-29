import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { TopBar } from '../components/layout/TopBar'
import { type AppNotification, useNotifications } from '../hooks/useNotifications'
import {
  type ActivityCategory,
  activityLink,
  categoryOf,
  describeActivity,
  groupByDay,
  millisOf,
} from '../utils/activity'
import { originState } from '../utils/taskOrigin'

type Filter = 'all' | 'unread' | ActivityCategory

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'unread', label: 'مش مقروءة' },
  { value: 'tasks', label: 'التاسكات' },
  { value: 'chat', label: 'الشات' },
  { value: 'files', label: 'الملفات' },
  { value: 'team', label: 'الفريق' },
]

function timeOf(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' }) : ''
}

/**
 * Everything that happened that concerns me — status changes, messages,
 * mentions, files, assignments — grouped by day. Written by the app itself
 * alongside each action (lib/activityLog.ts).
 */
export function NotificationsPage() {
  const { notifications, loading, unreadCount, hasMore, loadMore, markRead, markAllRead } = useNotifications(50)
  const [filter, setFilter] = useState<Filter>('all')
  const navigate = useNavigate()

  const visible = useMemo(
    () =>
      notifications.filter((n) =>
        filter === 'all' ? true : filter === 'unread' ? !n.read : categoryOf(n.type) === filter
      ),
    [notifications, filter]
  )
  const groups = groupByDay(visible)

  async function open(n: AppNotification) {
    if (!n.read) await markRead(n.id)
    const to = activityLink(n)
    if (to) navigate(to, { state: originState('Notifications', '/notifications') })
  }

  return (
    <>
      <TopBar
        crumbs={[{ label: 'Notifications' }]}
        actions={
          unreadCount > 0 ? (
            <button
              onClick={markAllRead}
              className="cursor-pointer text-[12.5px] font-medium text-text-muted hover:text-accent"
            >
              تحديد الكل كمقروء ({unreadCount})
            </button>
          ) : undefined
        }
      />

      <div dir="rtl" className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-5 overflow-y-auto p-8">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${
                filter === f.value ? 'bg-accent-tint text-accent-tint-text' : 'bg-field text-text-muted hover:text-text'
              }`}
            >
              {f.label}
              {f.value === 'unread' && unreadCount > 0 && ` · ${unreadCount}`}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-[13px] text-text-faint">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-text-faint">
            {filter === 'unread' ? 'مفيش إشعارات جديدة 🎉' : 'مفيش إشعارات لسه.'}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="flex flex-col gap-1.5">
              <h2 className="px-1 text-[11.5px] font-semibold text-text-faint">{g.label}</h2>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                {g.items.map((n, i) => {
                  const { icon, text } = describeActivity(n, true)
                  const link = activityLink(n)
                  return (
                    <button
                      key={n.id}
                      onClick={() => open(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-right ${i > 0 ? 'border-t border-border' : ''} ${
                        link ? 'cursor-pointer hover:bg-field' : 'cursor-default'
                      } ${n.read ? '' : 'bg-accent-tint/30'}`}
                    >
                      <span className="text-[15px] leading-6">{icon}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className={`text-[13px] leading-snug ${n.read ? 'text-text-muted' : 'font-medium text-text'}`}>
                          {text}
                        </span>
                        {n.detail && (n.type === 'comment.created' || n.type === 'comment.mention') && (
                          <span dir="auto" className="truncate rounded bg-field px-2 py-1 text-[12px] text-text-muted">
                            {n.detail}
                          </span>
                        )}
                        <span className="text-[11px] text-text-faint">
                          {[n.clientName, n.projectName].filter(Boolean).join(' / ')}
                          {n.projectName ? ' · ' : ''}
                          {timeOf(millisOf(n))}
                        </span>
                      </span>
                      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}

        {hasMore && !loading && (
          <button
            onClick={loadMore}
            className="mx-auto rounded-md px-4 py-2 text-[12.5px] font-medium text-text-muted hover:bg-field hover:text-text"
          >
            عرض أقدم
          </button>
        )}
      </div>
    </>
  )
}

