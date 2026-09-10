import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useState } from 'react'

import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { db } from '../../lib/firebase/app'
import type { ClientWithProjects } from '../../hooks/useClients'
import type { AssignedProject, Member, MemberRole } from '../../types/member'
import { ClientPicker } from './ClientPicker'
import { ProjectPicker } from './ProjectPicker'

export function EditMemberAccessModal({
  member,
  clients,
  canChangeRole,
  onClose,
}: {
  member: Member
  clients: ClientWithProjects[]
  /** Owner only. A manager may edit a plain member's project access, but
   * never promote/demote anyone. */
  canChangeRole: boolean
  onClose: () => void
}) {
  const [role, setRole] = useState<MemberRole>(member.role)
  const [projects, setProjects] = useState<AssignedProject[]>(member.assignedProjects || [])
  const [managedClientIds, setManagedClientIds] = useState<string[]>(member.managedClientIds || [])
  const [saving, setSaving] = useState(false)

  const effectiveRole: MemberRole = canChangeRole ? role : member.role

  async function handleSave() {
    setSaving(true)
    if (canChangeRole) {
      await updateDoc(doc(db, 'members', member.uid), {
        role: effectiveRole,
        assignedProjects: effectiveRole === 'member' ? projects : [],
        managedClientIds: effectiveRole === 'manager' ? managedClientIds : [],
        updatedAt: serverTimestamp(),
      })
    } else {
      // Manager: rules only allow an `assignedProjects`-only update.
      await updateDoc(doc(db, 'members', member.uid), {
        assignedProjects: projects,
        updatedAt: serverTimestamp(),
      })
    }
    setSaving(false)
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="flex flex-col gap-5 p-6">
        <div>
          <h2 className="text-lg font-bold text-text">Edit access</h2>
          <p className="text-[12.5px] text-text-muted">{member.displayName || member.email}</p>
        </div>

        {canChangeRole && (
          <FormField label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
              <option value="member">Member</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </Select>
          </FormField>
        )}

        {effectiveRole === 'manager' ? (
          <FormField label="Clients they manage">
            <ClientPicker clients={clients} selected={managedClientIds} onChange={setManagedClientIds} />
          </FormField>
        ) : effectiveRole === 'member' ? (
          <FormField label="Projects they can see">
            <ProjectPicker clients={clients} selected={projects} onChange={setProjects} />
          </FormField>
        ) : null}

        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
