import { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'

import { Avatar } from '../ui/Avatar'
import { useAuth } from '../../hooks/useAuth'
import { useClients, type ClientWithProjects } from '../../hooks/useClients'
import { ensureNotificationPermission, primeAudio } from '../../lib/notify'
import { isOwnerRole } from '../../utils/role'
import { AdminNav } from './AdminNav'
import { ClientProjectTree } from './ClientProjectTree'

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="3" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function NotificationsToggle() {
  const [state, setState] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )
  if (state === 'unsupported' || state === 'granted') return null

  return (
    <button
      onClick={async () => {
        primeAudio()
        const ok = await ensureNotificationPermission()
        setState(ok ? 'granted' : Notification.permission)
      }}
      className="mx-2 mb-1 flex items-center gap-2 rounded-md border border-accent/40 bg-accent-tint/40 px-2 py-1.5 text-[12px] font-medium text-text-muted hover:text-text"
    >
      🔔 فعّل إشعارات الرسائل
    </button>
  )
}

function SignOutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.2 8H6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Sidebar() {
  const { member, signOut } = useAuth()
  const isOwner = isOwnerRole(member?.role)

  // Owner: the real, full client/project tree. Member: only the
  // projects the owner has explicitly granted them (member.assignedProjects) —
  // built straight from that field, no extra query needed, since it
  // already carries the client/project names.
  const { clients: allClients } = useClients(isOwner)
  const memberTree = useMemo<ClientWithProjects[]>(() => {
    if (!member || isOwner) return []
    const byClient = new Map<string, ClientWithProjects>()
    for (const p of member.assignedProjects || []) {
      if (!byClient.has(p.clientId)) {
        byClient.set(p.clientId, { id: p.clientId, name: p.clientName, archived: false, projects: [] })
      }
      byClient.get(p.clientId)!.projects.push({
        id: p.projectId,
        name: p.projectName,
        status: 'active',
        clientId: p.clientId,
        clientName: p.clientName,
        totalHours: 0,
      })
    }
    return Array.from(byClient.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [member, isOwner])

  const clients = isOwner ? allClients : memberTree

  if (!member) return null

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-accent text-[13px]">🚀</div>
        <span className="text-sm font-semibold text-text">islam-life</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-4">
        <NavLink
          to="/calendar"
          className={({ isActive }) =>
            `mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
              isActive
                ? '-ml-[2.5px] border-l-[2.5px] border-accent bg-accent-tint font-semibold text-text'
                : 'text-text-muted'
            }`
          }
        >
          <CalendarIcon />
          Calendar
        </NavLink>
        <ClientProjectTree clients={clients} isOwner={isOwner} />
        {isOwner && <AdminNav />}
      </div>

      <NotificationsToggle />

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Avatar
          name={member.displayName || member.email}
          imageUrl={member.avatarUrl}
          colorClass={isOwner ? 'bg-avatar-a' : 'bg-avatar-b'}
          size={26}
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-muted">
          {member.displayName || member.email} &middot; {isOwner ? 'Owner' : 'Member'}
        </span>
        <button
          onClick={signOut}
          title="Sign out"
          className="cursor-pointer rounded-md p-1.5 text-text-faint hover:bg-field hover:text-red"
        >
          <SignOutIcon />
        </button>
      </div>
    </aside>
  )
}
