import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { type FormEvent, useEffect, useState } from 'react'

import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { useAuth } from '../../hooks/useAuth'
import type { ClientWithProjects } from '../../hooks/useClients'
import { useInvites } from '../../hooks/useInvites'
import { db } from '../../lib/firebase/app'
import type { AssignedProject, Member, MemberRole } from '../../types/member'
import { isOwnerRole } from '../../utils/role'
import { EditMemberAccessModal } from './EditMemberAccessModal'
import { InviteShareCard } from './InviteShareCard'
import { ProjectPicker } from './ProjectPicker'

async function sendInvite(email: string, role: MemberRole, assignedProjects: AssignedProject[], invitedBy: string) {
  const normalized = email.trim().toLowerCase()
  await setDoc(doc(db, 'invites', normalized), {
    email: normalized,
    role,
    assignedProjects,
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

export function TeamRoster({ members, clients }: { members: Member[]; clients: ClientWithProjects[] }) {
  const { member: me } = useAuth()
  const { invites } = useInvites()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('member')
  const [projects, setProjects] = useState<AssignedProject[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Member | null>(null)
  const [justInvited, setJustInvited] = useState<string | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)

  const pendingInvites = invites.filter((inv) => !members.some((m) => m.email === inv.email))

  // A person who just accepted an invite always lands as a bare
  // role:'member' with no projects (that's all a brand-new account can
  // self-provision — see firestore.rules). The moment the owner's own
  // browser sees both the invite AND the resulting member doc, apply
  // what the invite actually specified, then the invite has done its job.
  useEffect(() => {
    for (const inv of invites) {
      const joined = members.find((m) => m.email === inv.email)
      if (!joined) continue
      const alreadyApplied =
        joined.role === inv.role &&
        JSON.stringify(joined.assignedProjects || []) === JSON.stringify(inv.assignedProjects || [])
      if (alreadyApplied) {
        revokeInvite(inv.email)
        continue
      }
      updateDoc(doc(db, 'members', joined.uid), {
        role: inv.role,
        assignedProjects: inv.assignedProjects || [],
        updatedAt: serverTimestamp(),
      }).then(() => revokeInvite(inv.email))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invites, members])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !me) return
    setSending(true)
    setError(null)
    try {
      await sendInvite(trimmed, role, projects, me.uid)
      setJustInvited(trimmed.toLowerCase())
      setEmail('')
      setRole('member')
      setProjects([])
    } catch {
      setError("Couldn't send the invite — try again.")
    } finally {
      setSending(false)
    }
  }

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
          <FormField label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="rounded-[8px] border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
          </FormField>
        </div>

        {role === 'member' && (
          <FormField label="Projects they'll see">
            <ProjectPicker clients={clients} selected={projects} onChange={setProjects} />
          </FormField>
        )}

        <Button type="submit" variant="primary" disabled={sending || !email.trim()} className="w-fit">
          {sending ? 'Sending…' : 'Send invite'}
        </Button>
        {error && <p className="text-[12.5px] text-red">{error}</p>}
      </form>

      {justInvited && <InviteShareCard email={justInvited} />}

      <div className="overflow-hidden rounded-lg border border-border">
        {members.map((m, i) => (
          <div
            key={m.uid}
            className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}
          >
            <Avatar
              name={m.displayName || m.email}
              imageUrl={m.avatarUrl}
              colorClass={isOwnerRole(m.role) ? 'bg-avatar-a' : 'bg-avatar-b'}
              size={30}
            />
            <div className="flex flex-col">
              <span className="text-[13.5px] font-medium text-text">{m.displayName || m.email}</span>
              <span className="text-[12px] text-text-faint">
                {m.email}
                {!isOwnerRole(m.role) && (
                  <>
                    {' '}
                    &middot; {(m.assignedProjects || []).length}{' '}
                    {(m.assignedProjects || []).length === 1 ? 'project' : 'projects'}
                  </>
                )}
              </span>
            </div>
            <span
              className={`ml-auto rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                isOwnerRole(m.role) ? 'bg-accent-tint text-accent-tint-text' : 'bg-field text-text-muted'
              }`}
            >
              {isOwnerRole(m.role) ? 'Owner' : 'Member'}
            </span>
            {m.uid !== me?.uid && (
              <button
                onClick={() => setEditing(m)}
                className="cursor-pointer text-[12px] font-medium text-text-faint hover:text-text"
              >
                Edit access
              </button>
            )}
            {!isOwnerRole(m.role) && m.uid !== me?.uid && (
              <button
                onClick={() => removeMember(m.uid)}
                className="cursor-pointer text-[12px] font-medium text-text-faint hover:text-red"
              >
                Remove
              </button>
            )}
          </div>
        ))}
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
                      {isOwnerRole(inv.role) ? 'Owner' : `${(inv.assignedProjects || []).length} project(s)`}
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

      {editing && <EditMemberAccessModal member={editing} clients={clients} onClose={() => setEditing(null)} />}
    </div>
  )
}
