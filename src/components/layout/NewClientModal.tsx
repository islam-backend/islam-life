import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'

import { db } from '../../lib/firebase/app'
import { renameClient } from '../../lib/firebase/cascadeDelete'
import { fileToAvatarImage } from '../../lib/image'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Modal } from '../ui/Modal'

interface EditingClient {
  id: string
  name: string
  avatarUrl?: string
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
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(editingClient?.avatarUrl)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const isEditing = !!editingClient

  async function pickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      setAvatarUrl(await fileToAvatarImage(file))
    } catch {
      setError('الصورة مترفعتش — جرّب صورة أصغر')
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    if (editingClient) {
      if (trimmed !== editingClient.name) await renameClient(editingClient.id, trimmed)
      await updateDoc(doc(db, 'clients', editingClient.id), {
        avatarUrl: avatarUrl ?? null,
        updatedAt: serverTimestamp(),
      })
    } else {
      await addDoc(collection(db, 'clients'), {
        name: trimmed,
        archived: false,
        ...(avatarUrl ? { avatarUrl } : {}),
        createdAt: serverTimestamp(),
      })
    }
    setSaving(false)
    setName('')
    setAvatarUrl(undefined)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-6">
        <h2 className="text-lg font-bold text-text">{isEditing ? 'Edit client' : 'New client'}</h2>

        <div className="flex items-center gap-3">
          <Avatar name={name || '?'} imageUrl={avatarUrl} size={48} colorClass="bg-avatar-a" />
          <div className="flex flex-col gap-1">
            <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} className="hidden" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-fit rounded-md border border-border bg-field px-2.5 py-1 text-[12px] font-medium text-text-muted hover:text-text"
            >
              {avatarUrl ? 'غيّر الصورة' : 'أضف صورة'}
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={() => setAvatarUrl(undefined)}
                className="w-fit text-[11.5px] text-text-faint hover:text-red"
              >
                شيل الصورة
              </button>
            )}
          </div>
        </div>

        <FormField label="Client name">
          <input
            autoFocus
            required
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client A"
            className="w-full rounded-[8px] border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
          />
        </FormField>

        {error && <p className="text-[12px] text-red">{error}</p>}

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
