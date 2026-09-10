import type { ClientWithProjects } from '../../hooks/useClients'

/** Flat checkbox list of clients — used when promoting someone to a
 * scoped "manager" (they get owner-like control over every project inside
 * the clients ticked here). */
export function ClientPicker({
  clients,
  selected,
  onChange,
}: {
  clients: ClientWithProjects[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  if (clients.length === 0) {
    return <p className="text-[12.5px] text-text-faint">No clients yet — add one first.</p>
  }

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto rounded-[8px] border border-border bg-field p-3">
      {clients.map((client) => (
        <label key={client.id} className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={selected.includes(client.id)}
            onChange={() => toggle(client.id)}
            className="cursor-pointer accent-[var(--accent)]"
          />
          <span className="text-[13px] text-text">{client.name}</span>
        </label>
      ))}
    </div>
  )
}
