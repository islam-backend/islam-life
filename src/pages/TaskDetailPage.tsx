import { serverTimestamp, updateDoc } from 'firebase/firestore'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { AssigneePicker } from '../components/tasks/AssigneePicker'
import { PriorityControl } from '../components/tasks/PriorityControl'
import { StatusSegmentedControl } from '../components/tasks/StatusSegmentedControl'
import { TagsField } from '../components/tasks/TagsField'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useMembers } from '../hooks/useMembers'
import { useTaskDetail } from '../hooks/useTaskDetail'
import { TaskChat } from '../components/tasks/TaskChat'
import { deleteTaskCascade } from '../lib/firebase/cascadeDelete'
import { taskDocRef } from '../lib/firebase/refs'
import type { TaskAssignee, TaskPriority, TaskStatus } from '../types/task'
import { assigneeFields } from '../utils/assignees'
import { isOwnerRole } from '../utils/role'

function toDateInputValue(dueDate: unknown): string {
  const d = (dueDate as { toDate?: () => Date } | null)?.toDate?.()
  return d ? d.toISOString().slice(0, 10) : ''
}

function formatStamp(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | null)?.toDate?.()
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

/**
 * A real, standalone page — not an overlay on top of the task list.
 * Reached from the task table, Admin → All Assignments, or a direct
 * link; "Back" returns to wherever that was (see close() below).
 */
export function TaskDetailPage() {
  const { clientId = '', projectId = '', taskId = '' } = useParams()
  const navigate = useNavigate()
  const { member } = useAuth()
  const { members } = useMembers()
  const { task, loading } = useTaskDetail(clientId, projectId, taskId)
  const [description, setDescription] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isOwner = isOwnerRole(member?.role)
  const taskRef = taskDocRef(clientId, projectId, taskId)

  // Owner edits everything. An assigned member can move status + set
  // priority / tags / start date (see firestore.rules) but not reassign,
  // rewrite the description, or change the due date.
  const assignedToMe = !!member && (task?.assigneeUids ?? []).includes(member.uid)
  const canEdit = isOwner || assignedToMe

  const creator = members.find((m) => m.uid === task?.createdBy)

  function close() {
    // Go back to wherever this was opened from — the project's task
    // list, or Admin → All Assignments — instead of always forcing one
    // fixed destination. A direct link/bookmark (no real history) falls
    // back to the project page.
    if (window.history.length > 2) {
      navigate(-1)
    } else {
      navigate(`/clients/${clientId}/projects/${projectId}`)
    }
  }

  async function setStatus(status: TaskStatus) {
    await updateDoc(taskRef, { status, updatedAt: serverTimestamp() })
  }

  async function setAssignees(assignees: TaskAssignee[]) {
    await updateDoc(taskRef, { ...assigneeFields(assignees), updatedAt: serverTimestamp() })
  }

  async function setDueDate(value: string) {
    await updateDoc(taskRef, { dueDate: value ? new Date(value) : null, updatedAt: serverTimestamp() })
  }

  async function setStartDate(value: string) {
    await updateDoc(taskRef, { startDate: value ? new Date(value) : null, updatedAt: serverTimestamp() })
  }

  async function setPriority(priority: TaskPriority | null) {
    await updateDoc(taskRef, { priority, updatedAt: serverTimestamp() })
  }

  async function setTags(tags: string[]) {
    await updateDoc(taskRef, { tags, updatedAt: serverTimestamp() })
  }

  async function saveDescription() {
    if (description === null) return
    await updateDoc(taskRef, { description, updatedAt: serverTimestamp() })
  }

  async function handleDelete() {
    await deleteTaskCascade(clientId, projectId, taskId)
    close()
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">Loading…</div>
  }

  if (!task) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-[13px] text-text-muted">This task doesn't exist (or you don't have access to it).</p>
        <button onClick={close} className="cursor-pointer text-[12.5px] font-medium text-accent hover:underline">
          Back
        </button>
      </div>
    )
  }

  return (
    <>
      <TopBar
        crumbs={[
          { label: task.clientName },
          { label: task.projectName, to: `/clients/${clientId}/projects/${projectId}` },
        ]}
        actions={
          <button
            onClick={close}
            className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-text-muted hover:text-text"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M9.5 3.5L5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </button>
        }
      />

      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-7 overflow-y-auto p-8">
        <h1 className="text-2xl font-bold text-text">{task.title}</h1>

        <div className="grid grid-cols-[120px_1fr] items-center gap-y-4">
          <span className="self-start pt-1.5 text-[12.5px] font-medium text-text-faint">Assignees</span>
          <AssigneePicker value={task.assignees ?? []} members={members} onChange={setAssignees} disabled={!isOwner} />

          <span className="text-[12.5px] font-medium text-text-faint">Status</span>
          <StatusSegmentedControl value={task.status} onChange={setStatus} />

          <span className="text-[12.5px] font-medium text-text-faint">Priority</span>
          <PriorityControl value={task.priority} onChange={setPriority} disabled={!canEdit} />

          <span className="self-start pt-1.5 text-[12.5px] font-medium text-text-faint">Tags</span>
          <TagsField value={task.tags ?? []} onChange={setTags} disabled={!canEdit} />

          <span className="text-[12.5px] font-medium text-text-faint">Start date</span>
          <input
            type="date"
            disabled={!canEdit}
            defaultValue={toDateInputValue(task.startDate)}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-fit rounded-lg border border-border bg-field px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent disabled:opacity-60"
          />

          <span className="text-[12.5px] font-medium text-text-faint">Due date</span>
          <input
            type="date"
            disabled={!isOwner}
            defaultValue={toDateInputValue(task.dueDate)}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-fit rounded-lg border border-border bg-field px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent disabled:opacity-60"
          />
        </div>

        <p className="-mt-3 text-[11.5px] text-text-faint">
          Created by {creator?.displayName || creator?.email || 'someone'} · {formatStamp(task.createdAt)}
          {task.updatedAt ? ` · last edited ${formatStamp(task.updatedAt)}` : ''}
        </p>

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">Description</span>
          <textarea
            disabled={!isOwner}
            defaultValue={task.description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={5}
            placeholder="What needs to happen here?"
            className="resize-none rounded-lg border border-border bg-field px-4 py-3 text-[13.5px] leading-relaxed text-text-muted outline-none placeholder:text-text-faint focus:ring-1 focus:ring-accent disabled:opacity-70"
          />
        </div>

        <div className="h-px bg-border" />

        <TaskChat clientId={clientId} projectId={projectId} taskId={taskId} />

        {isOwner && (
          <div className="flex justify-end border-t border-border pt-5">
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-red">
              Delete task
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this task?"
        message={`"${task.title}" and its subtasks/comments will be gone for good. This can't be undone.`}
        confirmLabel="Delete task"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
