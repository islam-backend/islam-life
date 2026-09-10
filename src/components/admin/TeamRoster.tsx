import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { type FormEvent, useEffect, useState } from 'react'

import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Select } from '../ui/Select'
import { useAuth } from '../../hooks/useAuth'
import type { ClientWithProjects } from '../../hooks/useClients'
import { useInvites } from '../../hooks/useInvites'
import { db } from '../../lib/firebase/app'
import type { AssignedProject, Member, MemberRole } from '../../types/member'
import { isManagerRole, isOwnerRole } from '../../utils/role'
import { ClientPicker } from './ClientPicker'
import { EditMemberAccessModal } from './EditMemberAccessModal'
import { InviteShareCard } from './InviteShareCard'
import { ProjectPicker } from './ProjectPicker'

interface InvitePayload {
  email: string
  role: MemberRole
  assignedProjects: AssignedProject[]
  managedClientIds: string[]
  invitedBy: string
}

async function sendInvite({ email, role, assignedProjects, managedClientIds, invitedBy }: InvitePayload) {
  const normalized = email.trim().toLowerCase()
  await setDoc(doc(db, 'invites', normalized), {
    email: normalized,
    role,
    assignedProjects: role === 'member' ? assignedProjects : [],
    managedClientIds: role === 'manager' ? managedClientIds : [],
    invitedAt: serverTimestamp(),
    invitedBy,
  })
}

async function revokeInvite(email: string) {
  await deleteDoc(doc(db, 'invites', email))
}

async function removeMember(uid: string) {
  await deleteDoc(doc(db, 'members', uid))
}

function roleLabel(role: string | undefined): string {
  if (isOwnerRole(role)) return 'Owner'
  if (isManagerRole(role)) return 'Manager'
  return 'Member'
}

export function TeamRoster({
  members,
  clients,
  isOwner,
}: {
  members: Member[]
  clients: ClientWithProjects[]
  /** The viewer. A manager sees a trimmed roster: invite plain members
   * into their own clients, edit those members' project access — but no
   * role changes and no removing people from the workspace. */
  isOwner: boolean
}) {
  const { member: me } = useAuth()
  const { invites } = useInvites()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('member')
  const [projects, setProjects] = useState<AssignedProject[]>([])
  const [managedClientIds, setManagedClientIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Member | null>(null)
  const [justInvited, setJustInvited] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)

  const pendingInvites = invites.filter((inv) => !members.some((m) => m.email === inv.email))

  // A person who just accepted an invite always lands as a bare
  // role:'member' with no projects (that's all a brand-new account can
  // self-provision — see firestore.rules). Once this browser sees both
  // the invite AND the resulting member doc, apply what the invite asked
  // for, then the invite has done its job.
  //
  // A manager's browser can only patch `assignedProjects` (rules), which
  // is all a manager's invites ever change — role stays 'member'.
  useEffect(() => {
    for (const inv of invites) {
      const joined = members.find((m) => m.email === inv.email)
      if (!joined) continue

      const wantProjects = inv.role === 'member' ? inv.assignedProjects || [] : []
      const wantClientIds = inv.role === 'manager' ? inv.managedClientIds || [] : []
      const sameProjects = JSON.stringify(joined.assignedProjects || []) === JSON.stringify(wantProjects)
      const sameClientIds = JSON.stringify(joined.managedClientIds || []) === JSON.stringify(wantClientIds)

      if (joined.role === inv.role && sameProjects && sameClientIds) {
        revokeInvite(inv.email)
        continue
      }

      const patch: Record<string, unknown> = {
        role: inv.role,
        assignedProjects: wantProjects,
        updatedAt: serverTimestamp(),
      }
      // Only touch managedClientIds for a manager invite — writing it (even
      // as []) on a plain-member patch would break the manager-side rule
      // that allows an `assignedProjects`-only update.
      if (inv.role === 'manager') patch.managedClientIds = wantClientIds

      updateDoc(doc(db, 'members', joined.uid), patch).then(() => revokeInvite(inv.email))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invites, members])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !me) return
    const effectiveRole: MemberRole = isOwner ? role : 'member'
    setSending(true)
    setError(null)
    try {
      await sendInvite({
        email: trimmed,
        role: effectiveRole,
        assignedProjects: projects,
        managedClientIds,
        invitedBy: me.uid,
      })
      setJustInvited(trimmed.toLowerCase())
      setEmail('')
      setRole('member')
      setProjects([])
      setManagedClientIds([])
    } catch {
      setError("Couldn't send the invite — try again.")
    } finally {
      setSending(false)
    }
  }

  const invitingManager = isOwner && role === 'manager'

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleInvite} className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex items-end gap-2.5">
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-[12.5px] font-medium text-text-faint">Invite by email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@gmail.com"
              className="w-full rounded-[8px] border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
            />
          </div>
          {isOwner && (
            <FormField label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                <option value="member">Member</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </Select>
            </FormField>
          )}
        </div>

        {invitingManager ? (
          <FormField label="Clients they'll manage">
            <ClientPicker clients={clients} selected={managedClientIds} onChange={setManagedClientIds} />
          </FormField>
        ) : role !== 'owner' ? (
          <FormField label="Projects they'll see">
            <ProjectPicker clients={clients} selected={projects} onChange={setProjects} />
          </FormField>
        ) : null}

        <Button type="submit" variant="primary" disabled={sending || !email.trim()} className="w-fit">
          {sending ? 'Sending…' : 'Send invite'}
        </Button>
        {error && <p className="text-[12.5px] text-red">{error}</p>}
      </form>

      {justInvited && <InviteShareCard email={justInvited} />}

      <div className="overflow-hidden rounded-lg border border-border">
        {members.map((m, i) => {
          const canEditThisMember = isOwner ? m.uid !== me?.uid : !isOwnerRole(m.role) && !isManagerRole(m.role)
          const canRemoveThisMember = isOwner && !isOwnerRole(m.role) && m.uid !== me?.uid
          return (
            <div
              key={m.uid}
              className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <Avatar
                name={m.displayName || m.email}
                imageUrl={m.avatarUrl}
                colorClass={isOwnerRole(m.role) || isManagerRole(m.role) ? 'bg-avatar-a' : 'bg-avatar-b'}
                size={30}
              />
              <div className="flex flex-col">
                <span className="text-[13.5px] font-medium text-text">{m.displayName || m.email}</span>
                <span className="text-[12px] text-text-faint">
                  {m.email}
                  {isManagerRole(m.role) ? (
                    <>
                      {' '}
                      &middot; {(m.managedClientIds || []).length}{' '}
                      {(m.managedClientIds || []).length === 1 ? 'client' : 'clients'}
                    </>
                  ) : !isOwnerRole(m.role) ? (
                    <>
                      {' '}
                      &middot; {(m.assignedProjects || []).length}{' '}
                      {(m.assignedProjects || []).length === 1 ? 'project' : 'projects'}
                    </>
                  ) : null}
                </span>
              </div>
              <span
                className={`ml-auto rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                  isOwnerRole(m.role) || isManagerRole(m.role)
                    ? 'bg-accent-tint text-accent-tint-text'
                    : 'bg-field text-text-muted'
                }`}
              >
                {roleLabel(m.role)}
              </span>
              {canEditThisMember && (
                <button
                  onClick={() => setEditing(m)}
                  className="cursor-pointer text-[12px] font-medium text-text-faint hover:text-text"
                >
                  Edit access
                </button>
              )}
              {canRemoveThisMember && (
                <button
                  onClick={() => removeMember(m.uid)}
                  className="cursor-pointer text-[12px] font-medium text-text-faint hover:text-red"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>

      {pendingInvites.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
            Pending — waiting for them to sign in
          </span>
          <div className="overflow-hidden rounded-lg border border-border">
            {pendingInvites.map((inv, i) => (
              <div key={inv.email} className={i > 0 ? 'border-t border-border' : ''}>
                <div className="flex items-center gap-3 px-5 py-3">
                  <div className="flex flex-col">
                    <span className="text-[13px] text-text-muted">{inv.email}</span>
                    <span className="text-[11.5px] text-text-faint">
                      {isOwnerRole(inv.role)
                        ? 'Owner'
                        : isManagerRole(inv.role)
                          ? `Manager · ${(inv.managedClientIds || []).length} client(s)`
                          : `${(inv.assignedProjects || []).length} project(s)`}
                    </span>
                  </div>
                  <button
                    onClick={() => setSharing(sharing === inv.email ? null : inv.email)}
                    className="ml-auto cursor-pointer text-[12px] font-medium text-accent hover:underline"
                  >
                    {sharing === inv.email ? 'إخفاء' : 'رسالة الدعوة'}
                  </button>
                  <button
                    onClick={() => revokeInvite(inv.email)}
                    className="cursor-pointer text-[12px] font-medium text-text-faint hover:text-red"
                  >
                    Cancel
                  </button>
                </div>
                {sharing === inv.email && (
                  <div className="px-5 pb-3">
                    <InviteShareCard email={inv.email} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <EditMemberAccessModal
          member={editing}
          clients={clients}
          canChangeRole={isOwner}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
