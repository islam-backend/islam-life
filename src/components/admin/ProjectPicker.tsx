import type { ClientWithProjects } from '../../hooks/useClients'
import type { AssignedProject } from '../../types/member'

/** Checkbox tree (client → projects) used both when sending an invite
 * and when editing an existing member's access. */
export function ProjectPicker({
  clients,
  selected,
  onChange,
}: {
  clients: ClientWithProjects[]
  selected: AssignedProject[]
  onChange: (next: AssignedProject[]) => void
}) {
  function isSelected(projectId: string) {
    return selected.some((p) => p.projectId === projectId)
  }

  function toggle(client: ClientWithProjects, projectId: string, projectName: string) {
    if (isSelected(projectId)) {
      onChange(selected.filter((p) => p.projectId !== projectId))
    } else {
      onChange([...selected, { clientId: client.id, clientName: client.name, projectId, projectName }])
    }
  }

  if (clients.length === 0) {
    return <p className="text-[12.5px] text-text-faint">No clients yet — add one first.</p>
  }

  return (
    <div className="flex max-h-60 flex-col gap-3 overflow-y-auto rounded-[8px] border border-border bg-field p-3">
      {clients.map((client) => (
        <div key={client.id} className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-text-muted">{client.name}</span>
          {client.projects.length === 0 ? (
            <span className="pl-1 text-[12px] text-text-faint">No projects yet</span>
          ) : (
            client.projects.map((project) => (
              <label key={project.id} className="flex cursor-pointer items-center gap-2 pl-1">
                <input
                  type="checkbox"
                  checked={isSelected(project.id)}
                  onChange={() => toggle(client, project.id, project.name)}
                  className="cursor-pointer accent-[var(--accent)]"
                />
                <span className="text-[13px] text-text">{project.name}</span>
              </label>
            ))
          )}
        </div>
      ))}
    </div>
  )
}
