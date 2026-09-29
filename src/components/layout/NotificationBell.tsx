import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { type AppNotification, useNotifications } from '../../hooks/useNotifications'
import { activityLink, describeActivity, millisOf, relativeTimeAr } from '../../utils/activity'

function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.5A4.5 4.5 0 0 0 3.5 6v2.5L2 10h12l-1.5-1.5V6A4.5 4.5 0 0 0 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M6.5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  )
}

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(20)
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Close when clicking outside
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function handleClick(n: AppNotification) {
    if (!n.read) await markRead(n.id)
    setOpen(false)
    const to = activityLink(n)
    if (to) navigate(to)
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="الإشعارات"
        className="relative cursor-pointer rounded-md p-1.5 text-text-faint hover:bg-field hover:text-text"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-accent px-[3px] text-[9px] font-bold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          dir="rtl"
          className="absolute bottom-full left-0 z-50 mb-2 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[12px] font-semibold text-text">الإشعارات</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-text-muted hover:text-accent">
                تحديد الكل كمقروء
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-5 text-center text-[12px] text-text-faint">لا توجد إشعارات</p>
            ) : (
              notifications.map((n) => {
                const { icon, text } = describeActivity(n, true)
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`flex w-full items-start gap-2 px-3 py-2.5 text-right hover:bg-field ${
                      n.read ? 'opacity-60' : ''
                    }`}
                  >
                    <span className="text-[13px] leading-5">{icon}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={`text-[12px] leading-snug ${n.read ? 'text-text-muted' : 'font-medium text-text'}`}>
                        {text}
                      </span>
                      <span className="text-[10.5px] text-text-faint">{relativeTimeAr(millisOf(n))}</span>
                    </span>
                    {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  </button>
                )
              })
            )}
          </div>

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2 text-center text-[12px] font-medium text-accent hover:bg-field"
          >
            عرض كل الإشعارات
          </Link>
        </div>
      )}
    </div>
  )
}
