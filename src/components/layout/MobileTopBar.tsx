import { getAppName } from '../../lib/firebase/config'
import { NotificationBell } from './NotificationBell'

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** Only shown below the `md` breakpoint — replaces the always-visible desktop
 * sidebar header with a bar + hamburger that opens it as a drawer instead. */
export function MobileTopBar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div
      className="shrink-0 border-b border-border bg-surface md:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex h-14 items-center gap-3 px-3">
        <button
          onClick={onMenuClick}
          aria-label="Menu"
          className="-ml-1.5 rounded-md p-2 text-text-muted hover:bg-field hover:text-text"
        >
          <MenuIcon />
        </button>
        <span className="flex-1 truncate text-sm font-semibold text-text">{getAppName()}</span>
        <NotificationBell />
      </div>
    </div>
  )
}
