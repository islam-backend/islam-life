import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { AssigneePicker } from '../components/tasks/AssigneePicker'
import { PriorityControl } from '../components/tasks/PriorityControl'
import { StatusSegmentedControl } from '../components/tasks/StatusSegmentedControl'
import { TagsField } from '../components/tasks/TagsField'
import { TaskAttachments } from '../components/tasks/TaskAttachments'
import { TaskCompletionProof } from '../components/tasks/TaskCompletionProof'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StatusPill } from '../components/ui/StatusPill'
import { useAuth } from '../hooks/useAuth'
import { useMembers } from '../hooks/useMembers'
import { useTaskDetail } from '../hooks/useTaskDetail'
import { TaskChat } from '../components/tasks/TaskChat'
import { logActivity, taskChangeEntries, updateTaskLogged } from '../lib/activityLog'
import { archiveTasks, restoreTasks } from '../lib/firebase/archive'
import { deleteTaskCascade } from '../lib/firebase/cascadeDelete'
import type { Task, TaskAssignee, TaskPriority, TaskStatus } from '../types/task'
import { assigneeFields } from '../utils/assignees'
import { canManageClient } from '../utils/role'
import { STATUS_LABEL, isArchived } from '../utils/taskStatus'
import { readOrigin } from '../utils/taskOrigin'

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
  // Set by whichever list linked here (My Tasks, All Assignments, …).
  const origin = readOrigin(useLocation().state)
  const { member } = useAuth()
  const { members } = useMembers()
  const { task, loading } = useTaskDetail(clientId, projectId, taskId)
  const [description, setDescription] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  // Scroll to the chat section when opened from a notification (URL hash #chat)
  useEffect(() => {
    if (window.location.hash === '#chat') {
      const timer = setTimeout(() => {
        chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [])

  // Owner, or a manager of this task's client, edits everything. An
  // assigned member can move status + set priority / tags / start date
  // (see firestore.rules) but not reassign, rewrite the description, or
  // change the due date.
  const canManage = canManageClient(member, clientId)

  const assignedToMe = !!member && (task?.assigneeUids ?? []).includes(member.uid)
  const archived = !!task && isArchived(task)
  // An archived task is read-only for members until someone restores it.
  const canEdit = canManage || (assignedToMe && !archived)

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

  // Every edit goes through updateTaskLogged so it lands in the audit log
  // and notifies the people on the task.
  async function update(patch: Partial<Task>) {
    if (task) await updateTaskLogged(task, patch)
  }

  async function setStatus(status: TaskStatus) {
    await update({ status })
  }

  async function setAssignees(assignees: TaskAssignee[]) {
    await update(assigneeFields(assignees))
  }

  async function setDueDate(value: string) {
    await update({ dueDate: value ? new Date(value) : null })
  }

  async function setStartDate(value: string) {
    await update({ startDate: value ? new Date(value) : null })
  }

  async function setPriority(priority: TaskPriority | null) {
    await update({ priority })
  }

  async function setTags(tags: string[]) {
    await update({ tags })
  }

  async function saveTitle(input: HTMLInputElement) {
    const title = input.value.trim()
    // An empty title isn't allowed — snap back to the current one.
    if (!title || title === task?.title) {
      input.value = task?.title ?? ''
      return
    }
    await update({ title })
  }

  async function saveDescription() {
    if (description === null || description === task?.description) return
    await update({ description })
  }

  async function handleDelete() {
    await deleteTaskCascade(clientId, projectId, taskId)
    if (task) void logActivity(taskChangeEntries(task, null))
    close()
  }

  async function handleArchive() {
    if (!task || !member) return
    await archiveTasks([task], member.uid)
    close()
  }

  async function handleRestore() {
    if (task) await restoreTasks([task])
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
          ...(origin ? [origin] : []),
          { label: task.clientName },
          { label: task.projectName, to: `/clients/${clientId}/projects/${projectId}` },
          { label: task.title },
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
        {archived && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-field px-4 py-3">
            <p className="text-[12.5px] text-text-muted">
              This task is archived — hidden from every list and the calendar
              {task.archivedFrom ? ` (was ${STATUS_LABEL[task.archivedFrom] ?? task.archivedFrom})` : ''}.
            </p>
            {canManage && (
              <button
                onClick={handleRestore}
                className="shrink-0 cursor-pointer text-[12.5px] font-semibold text-accent hover:underline"
              >
                Restore
              </button>
            )}
          </div>
        )}

        {canManage ? (
          <input
            // Remount on a remote rename so the field picks up the new title.
            key={task.title}
            dir="auto"
            defaultValue={task.title}
            onBlur={(e) => saveTitle(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                e.currentTarget.value = task.title
                e.currentTarget.blur()
              }
            }}
            aria-label="Task title"
            className="-mx-2 rounded-lg bg-transparent px-2 py-1 text-2xl font-bold text-text outline-none hover:bg-field/60 focus:bg-field focus:ring-1 focus:ring-accent"
          />
        ) : (
          <h1 dir="auto" className="text-2xl font-bold text-text">{task.title}</h1>
        )}

        <div className="grid grid-cols-[120px_1fr] items-center gap-y-4">
          <span className="self-start pt-1.5 text-[12.5px] font-medium text-text-faint">Assignees</span>
          <AssigneePicker value={task.assignees ?? []} members={members} onChange={setAssignees} disabled={!canManage} />

          <span className="text-[12.5px] font-medium text-text-faint">Status</span>
          {archived ? (
            <StatusPill status={task.status} />
          ) : (
            <StatusSegmentedControl value={task.status} onChange={setStatus} />
          )}

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
            disabled={!canManage}
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
            dir="auto"
            disabled={!canManage}
            defaultValue={task.description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            rows={5}
            placeholder="What needs to happen here?"
            className="resize-none rounded-lg border border-border bg-field px-4 py-3 text-[13.5px] leading-relaxed text-text-muted outline-none placeholder:text-text-faint focus:ring-1 focus:ring-accent disabled:opacity-70"
          />
        </div>

        <div className="h-px bg-border" />

        <TaskCompletionProof
          task={task}
          clientId={clientId}
          projectId={projectId}
          taskId={taskId}
          isDone={task.status === 'done'}
          canEdit={canEdit}
          canDelete={canManage}
        />

        <div className="h-px bg-border" />

        <TaskAttachments
          task={task}
          clientId={clientId}
          projectId={projectId}
          taskId={taskId}
          canEdit={canEdit}
          canDelete={canManage}
        />

        <div className="h-px bg-border" />

        <div ref={chatRef} id="chat">
          <TaskChat clientId={clientId} projectId={projectId} taskId={taskId} task={task} />
        </div>

        {canManage && (
          <div className="flex justify-end gap-2 border-t border-border pt-5">
            {archived ? (
              <Button variant="ghost" onClick={handleRestore}>
                Restore task
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleArchive}>
                Archive task
              </Button>
            )}
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
