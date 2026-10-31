import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { useMessagePing } from '../../hooks/useMessagePing'
import { useRegisterPushToken } from '../../hooks/useRegisterPushToken'
import { setupAudioAutoUnlock, setupNativeNotificationTapHandler } from '../../lib/notify'
import { MobileTopBar } from './MobileTopBar'
import { Sidebar } from './Sidebar'

export function AppShell() {
  // Sound + background notification when a new chat message arrives.
  useMessagePing()

  // Native only: keeps members/{uid}.fcmToken current so the push-relay
  // Worker can reach this device when the app is backgrounded or closed.
  const { user, member } = useAuth()
  useRegisterPushToken(user?.uid, member?.fcmToken)

  // Unlocks the ping sound on the first click/keypress anywhere in the app —
  // needed even when Notification permission was already granted in a past
  // visit, since then the one button that used to prime audio never renders.
  useEffect(() => {
    setupAudioAutoUnlock()
    setupNativeNotificationTapHandler()
  }, [])

  // Below `md`, the sidebar becomes a drawer toggled from MobileTopBar —
  // close it on every navigation, whichever link inside it was tapped.
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  return (
    <div className="flex h-full bg-bg">
      <Sidebar mobileOpen={navOpen} onClose={() => setNavOpen(false)} />
      {/* min-h-0 is load-bearing: without it a flex child can't shrink below
          its content's height, so a tall page pushes the whole document
          (sidebar included) into scrolling instead of scrolling internally. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileTopBar onMenuClick={() => setNavOpen(true)} />
        <Outlet />
      </div>
    </div>
  )
}
