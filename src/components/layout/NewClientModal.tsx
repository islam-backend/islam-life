import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { type FormEvent, useState } from 'react'

import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Modal } from '../ui/Modal'
import { db } from '../../lib/firebase/app'
import { renameClient } from '../../lib/firebase/cascadeDelete'

interface EditingClient {
  id: string
  name: string
}

export function NewClientModal({
  open,
  onClose,
  editingClient,
}: {
  open: boolean
  onClose: () => void
  editingClient?: EditingClient | null
}) {
  const [name, setName] = useState(editingClient?.name ?? '')
  const [saving, setSaving] = useState(false)
  const isEditing = !!editingClient

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    if (editingClient) {
      await renameClient(editingClient.id, trimmed)
    } else {
      await addDoc(collection(db, 'clients'), {
        name: trimmed,
        archived: false,
        createdAt: serverTimestamp(),
      })
    }
    setSaving(false)
    setName('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-6">
        <h2 className="text-lg font-bold text-text">{isEditing ? 'Rename client' : 'New client'}</h2>
        <FormField label="Client name">
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client A"
            className="w-full rounded-[8px] border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </FormField>
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : isEditing ? 'Save' : 'Create client'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
