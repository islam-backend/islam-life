import { Link } from 'react-router-dom'

import { useNotifications } from '../../hooks/useNotifications'

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

/** Unread badge that opens the full Notifications page (no popup). */
export function NotificationBell() {
  const { unreadCount } = useNotifications(100)

  return (
    <Link
      to="/notifications"
      title="الإشعارات"
      className="relative rounded-md p-1.5 text-text-faint hover:bg-field hover:text-text"
    >
      <BellIcon />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-accent px-[3px] text-[9px] font-bold leading-none text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  )
}
