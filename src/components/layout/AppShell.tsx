import { Outlet } from 'react-router-dom'

import { useMessagePing } from '../../hooks/useMessagePing'
import { Sidebar } from './Sidebar'

export function AppShell() {
  // Sound + background notification when a new chat message arrives.
  useMessagePing()

  return (
    <div className="flex h-full bg-bg">
      <Sidebar />
      {/* min-h-0 is load-bearing: without it a flex child can't shrink below
          its content's height, so a tall page pushes the whole document
          (sidebar included) into scrolling instead of scrolling internally. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  )
}
