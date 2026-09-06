import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { type FormEvent, useState } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { db } from '../../lib/firebase/app'
import type { Member } from '../../types/member'
import type { TaskAssignee, TaskPriority } from '../../types/task'
import { assigneeFields } from '../../utils/assignees'
import { Button } from '../ui/Button'
import { FormField } from '../ui/FormField'
import { Modal } from '../ui/Modal'
import { AssigneePicker } from './AssigneePicker'
import { PriorityControl } from './PriorityControl'
import { TagsField } from './TagsField'

const fieldClass =
  'w-full rounded-[8px] border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent'

export function NewTaskModal({
  open,
  onClose,
  clientId,
  clientName,
  projectId,
  projectName,
  members,
  taskCount,
}: {
  open: boolean
  onClose: () => void
  clientId: string
  clientName: string
  projectId: string
  projectName: string
  members: Member[]
  taskCount: number
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [priority, setPriority] = useState<TaskPriority | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle('')
    setAssignees([])
    setPriority(null)
    setTags([])
    setStartDate('')
    setDueDate('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    setSaving(true)

    await addDoc(collection(db, 'clients', clientId, 'projects', projectId, 'tasks'), {
      title: trimmed,
      description: '',
      status: 'todo',
      ...assigneeFields(assignees),
      priority,
      tags,
      startDate: startDate ? new Date(startDate) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      clientId,
      clientName,
      projectId,
      projectName,
      orderIndex: taskCount,
      hoursLogged: 0,
      createdBy: user?.uid ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })

    setSaving(false)
    reset()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-6">
        <h2 className="text-lg font-bold text-text">New task</h2>

        <FormField label="Title">
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Design homepage hero section"
            className={fieldClass}
          />
        </FormField>

        <FormField label="Assignees">
          <AssigneePicker value={assignees} members={members} onChange={setAssignees} />
        </FormField>

        <div className="flex flex-wrap items-start gap-4">
          <FormField label="Priority">
            <PriorityControl value={priority} onChange={setPriority} />
          </FormField>
          <FormField label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`${fieldClass} w-fit`}
            />
          </FormField>
          <FormField label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={`${fieldClass} w-fit`}
            />
          </FormField>
        </div>

        <FormField label="Tags">
          <TagsField value={tags} onChange={setTags} />
        </FormField>

        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
