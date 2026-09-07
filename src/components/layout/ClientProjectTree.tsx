import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { ClientWithProjects } from '../../hooks/useClients'
import { db } from '../../lib/firebase/app'
import { deleteClientCascade, deleteProjectCascade } from '../../lib/firebase/cascadeDelete'
import type { Project } from '../../types/project'
import { NewClientModal } from './NewClientModal'
import { NewProjectModal } from './NewProjectModal'

/** Persist a client's project order after a drag. */
async function persistProjectOrder(clientId: string, orderedIds: string[]) {
  const batch = writeBatch(db)
  orderedIds.forEach((projectId, i) => {
    batch.update(doc(db, 'clients', clientId, 'projects', projectId), {
      orderIndex: i,
      updatedAt: serverTimestamp(),
    })
  })
  await batch.commit()
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
      <circle cx="5.5" cy="4" r="1.3" /><circle cx="10.5" cy="4" r="1.3" />
      <circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" />
      <circle cx="5.5" cy="12" r="1.3" /><circle cx="10.5" cy="12" r="1.3" />
    </svg>
  )
}

// A plain ">" glyph — rotating it 90° turns it into a "v", so ONE path
// covers both states. Keep these two in sync; a name/rotation mismatch
// here is exactly the bug that shipped once already.
function Chevron({ direction }: { direction: 'right' | 'down' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 text-text-muted transition-transform"
      style={{ transform: direction === 'down' ? 'rotate(90deg)' : undefined }}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path
        d="M11.3 2.3a1.5 1.5 0 0 1 2.1 2.1L5 12.8l-2.8.7.7-2.8 8.4-8.4z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5V13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Small, owner-only rename/delete pair — shown on row hover so it never
 * competes with the row's own label at rest. */
function RowActions({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  return (
    <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onRename()
        }}
        title="Rename"
        className="cursor-pointer rounded p-1 text-text-faint hover:bg-surface hover:text-text"
      >
        <PencilIcon />
      </button>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete()
        }}
        title="Delete"
        className="cursor-pointer rounded p-1 text-text-faint hover:bg-surface hover:text-red"
      >
        <TrashIcon />
      </button>
    </span>
  )
}

export function ClientProjectTree({
  clients,
  isOwner,
}: {
  clients: ClientWithProjects[]
  isOwner: boolean
}) {
  const navigate = useNavigate()
  const { clientId: activeClientId, projectId: activeProjectId } = useParams()
  const [expanded, setExpanded] = useState<Set<string>>(new Set(activeClientId ? [activeClientId] : []))

  const [showNewClient, setShowNewClient] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientWithProjects | null>(null)
  const [deletingClient, setDeletingClient] = useState<ClientWithProjects | null>(null)

  const [newProjectFor, setNewProjectFor] = useState<ClientWithProjects | null>(null)
  const [editingProject, setEditingProject] = useState<{ client: ClientWithProjects; project: Project } | null>(null)
  const [deletingProject, setDeletingProject] = useState<{ client: ClientWithProjects; project: Project } | null>(
    null
  )

  const [drag, setDrag] = useState<{ clientId: string; projectId: string } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  async function dropOnProject(client: ClientWithProjects, targetId: string) {
    const d = drag
    setDrag(null)
    setOverId(null)
    if (!d || d.clientId !== client.id || d.projectId === targetId) return
    const ids = client.projects.map((p) => p.id)
    ids.splice(ids.indexOf(d.projectId), 1)
    ids.splice(ids.indexOf(targetId), 0, d.projectId)
    try {
      await persistProjectOrder(client.id, ids)
    } catch {
      /* onSnapshot will keep the old order — nothing else to do */
    }
  }

  function toggle(clientId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(clientId) ? next.delete(clientId) : next.add(clientId)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Clients</span>
        {isOwner && (
          <button
            onClick={() => setShowNewClient(true)}
            title="Add client"
            className="cursor-pointer rounded-md p-1 text-text-faint hover:bg-field hover:text-text"
          >
            <PlusIcon />
          </button>
        )}
      </div>

      {clients.length === 0 && (
        <p className="px-2 text-[12.5px] text-text-faint">
          {isOwner ? 'No clients yet — add one above to get started.' : "You haven't been given access to a project yet."}
        </p>
      )}

      <div className="flex flex-col gap-0.5">
        {clients.map((client) => {
          const isExpanded = expanded.has(client.id)
          return (
            <div key={client.id} className="flex flex-col gap-0.5">
              <div className="group flex items-center rounded-md hover:bg-field">
                <button
                  onClick={() => toggle(client.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 py-1.5 text-left"
                >
                  <Chevron direction={isExpanded ? 'down' : 'right'} />
                  <span className="truncate text-[13.5px] font-medium text-text">{client.name}</span>
                </button>
                {isOwner && (
                  <RowActions
                    onRename={() => setEditingClient(client)}
                    onDelete={() => setDeletingClient(client)}
                  />
                )}
              </div>

              {isExpanded && (
                <div className="flex flex-col gap-0.5 pl-5">
                  {client.projects.map((project) => {
                    const active = project.id === activeProjectId
                    const dropHere = overId === project.id && drag?.projectId !== project.id
                    return (
                      <div
                        key={project.id}
                        draggable={isOwner}
                        onDragStart={() => setDrag({ clientId: client.id, projectId: project.id })}
                        onDragEnter={() => drag?.clientId === client.id && setOverId(project.id)}
                        onDragOver={(e) => {
                          if (drag?.clientId === client.id) e.preventDefault()
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          void dropOnProject(client, project.id)
                        }}
                        onDragEnd={() => {
                          setDrag(null)
                          setOverId(null)
                        }}
                        className={`group flex items-center rounded-md ${
                          active ? '-ml-[2.5px] border-l-[2.5px] border-accent bg-accent-tint' : ''
                        } ${dropHere ? 'border-t-2 border-t-accent' : ''} ${
                          drag?.projectId === project.id ? 'opacity-40' : ''
                        }`}
                      >
                        {isOwner && (
                          <span className="-mr-1 cursor-grab pl-1 text-text-faint opacity-0 group-hover:opacity-100 active:cursor-grabbing">
                            <GripIcon />
                          </span>
                        )}
                        <Link
                          to={`/clients/${client.id}/projects/${project.id}`}
                          draggable={false}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-text-faint'}`}
                          />
                          <span
                            dir="auto"
                            className={`truncate text-[13px] ${active ? 'font-semibold text-text' : 'text-text-muted'}`}
                          >
                            {project.name}
                          </span>
                        </Link>
                        {isOwner && (
                          <RowActions
                            onRename={() => setEditingProject({ client, project })}
                            onDelete={() => setDeletingProject({ client, project })}
                          />
                        )}
                      </div>
                    )
                  })}

                  {isOwner && (
                    <button
                      onClick={() => setNewProjectFor(client)}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-text-faint hover:bg-field hover:text-text-muted"
                    >
                      <PlusIcon />
                      <span className="text-[12.5px]">Add project</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <NewClientModal open={showNewClient} onClose={() => setShowNewClient(false)} />
      {editingClient && (
        <NewClientModal
          open
          onClose={() => setEditingClient(null)}
          editingClient={{ id: editingClient.id, name: editingClient.name, avatarUrl: editingClient.avatarUrl }}
        />
      )}
      {newProjectFor && (
        <NewProjectModal
          open
          onClose={() => setNewProjectFor(null)}
          clientId={newProjectFor.id}
          clientName={newProjectFor.name}
        />
      )}
      {editingProject && (
        <NewProjectModal
          open
          onClose={() => setEditingProject(null)}
          clientId={editingProject.client.id}
          clientName={editingProject.client.name}
          editingProject={{ id: editingProject.project.id, name: editingProject.project.name }}
        />
      )}

      <ConfirmDialog
        open={!!deletingClient}
        title="Delete this client?"
        message={`"${deletingClient?.name}" and every one of its projects and tasks will be gone for good. This can't be undone.`}
        confirmLabel="Delete client"
        onConfirm={async () => {
          if (deletingClient) await deleteClientCascade(deletingClient.id)
          if (deletingClient?.id === activeClientId) navigate('/')
        }}
        onClose={() => setDeletingClient(null)}
      />

      <ConfirmDialog
        open={!!deletingProject}
        title="Delete this project?"
        message={`"${deletingProject?.project.name}" and all of its tasks will be gone for good. This can't be undone.`}
        confirmLabel="Delete project"
        onConfirm={async () => {
          if (deletingProject) await deleteProjectCascade(deletingProject.client.id, deletingProject.project.id)
          if (deletingProject?.project.id === activeProjectId) navigate('/')
        }}
        onClose={() => setDeletingProject(null)}
      />
    </div>
  )
}
