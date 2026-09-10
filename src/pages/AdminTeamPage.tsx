import { TeamRoster } from '../components/admin/TeamRoster'
import { TopBar } from '../components/layout/TopBar'
import { useAuth } from '../hooks/useAuth'
import { useClients } from '../hooks/useClients'
import { useMembers } from '../hooks/useMembers'
import { isOwnerRole } from '../utils/role'

export function AdminTeamPage() {
  const { member } = useAuth()
  const { members } = useMembers()
  const { clients } = useClients()

  const isOwner = isOwnerRole(member?.role)
  const managedClientIds = member?.managedClientIds ?? []
  // A manager only ever works with (and grants) their own clients.
  const visibleClients = isOwner ? clients : clients.filter((c) => managedClientIds.includes(c.id))

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'Team' }]} />
      <div className="flex-1 overflow-y-auto p-6">
        <TeamRoster members={members} clients={visibleClients} isOwner={isOwner} />
      </div>
    </>
  )
}
