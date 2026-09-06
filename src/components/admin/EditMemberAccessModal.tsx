import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useState } from 'react'

import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Modal } from '../ui/Modal'
import { db } from '../../lib/firebase/app'
import type { ClientWithProjects } from '../../hooks/useClients'
import type { AssignedProject, Member, MemberRole } from '../../types/member'
import { ProjectPicker } from './ProjectPicker'

export function EditMemberAccessModal({
  member,
  clients,
  onClose,
}: {
  member: Member
  clients: ClientWithProjects[]
  onClose: () => void
}) {
  const [role, setRole] = useState<MemberRole>(member.role)
  const [projects, setProjects] = useState<AssignedProject[]>(member.assignedProjects || [])
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await updateDoc(doc(db, 'members', member.uid), {
      role,
      assignedProjects: projects,
      updatedAt: serverTimestamp(),
    })
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

        <FormField label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="w-full rounded-[8px] border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          >
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
        </FormField>

        {role === 'member' && (
          <FormField label="Projects they can see">
            <ProjectPicker clients={clients} selected={projects} onChange={setProjects} />
          </FormField>
        )}

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
