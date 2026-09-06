import { TeamRoster } from '../components/admin/TeamRoster'
import { TopBar } from '../components/layout/TopBar'
import { useClients } from '../hooks/useClients'
import { useMembers } from '../hooks/useMembers'

export function AdminTeamPage() {
  const { members } = useMembers()
  const { clients } = useClients()

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'Team' }]} />
      <div className="flex-1 overflow-y-auto p-6">
        <TeamRoster members={members} clients={clients} />
      </div>
    </>
  )
}
