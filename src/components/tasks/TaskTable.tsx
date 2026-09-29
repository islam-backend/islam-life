import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { moveTasksToStatus } from '../../lib/firebase/bulkStatus'
import { downloadMarkdown, markdownFileName, tasksToAiPrompt, tasksToMarkdown } from '../../lib/tasksMarkdown'
import type { Member } from '../../types/member'
import type { Task, TaskStatus } from '../../types/task'
import { STATUS_LABEL, STATUS_ORDER, nextStatus } from '../../utils/taskStatus'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Select } from '../ui/Select'
import { StatusPill } from '../ui/StatusPill'
import { TASK_GRID, TaskRow } from './TaskRow'

const headerClass = 'text-[11.5px] font-semibold uppercase tracking-wide text-text-faint'
const checkboxClass = 'h-4 w-4 shrink-0 cursor-pointer accent-accent'
const barButtonClass =
  'rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-text-muted hover:bg-field hover:text-text'

function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} className={checkboxClass} />
}

/**
 * The project's task list, grouped by status. Each group can push all its
 * tasks to the next stage; selected tasks (any groups) can be moved to any
 * status or exported as Markdown from the selection bar.
 *
 * `exportHeading` (e.g. "Client — Project") turns on selection. Remount
 * (key) per project so the selection doesn't carry over.
 */
export function TaskTable({
  tasks,
  members = [],
  exportHeading,
}: {
  tasks: Task[]
  members?: Member[]
  exportHeading?: string
}) {
  const location = useLocation()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<'md' | 'ai' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [confirmGroup, setConfirmGroup] = useState<TaskStatus | null>(null)

  // Only count tasks still visible under the current filters, in table order.
  // Older docs can carry a status outside the known five — give those their
  // own trailing group(s) instead of silently dropping them.
  const legacy = Array.from(new Set(tasks.map((t) => t.status).filter((s) => !STATUS_ORDER.includes(s))))
  const groups = [...STATUS_ORDER, ...legacy]
    .map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) }))
    .filter((g) => g.tasks.length > 0)
  const ordered = groups.flatMap((g) => g.tasks)
  const selectedTasks = ordered.filter((t) => selected.has(t.id))

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  function toggle(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function copy(kind: 'md' | 'ai') {
    if (!exportHeading) return
    const text =
      kind === 'md' ? tasksToMarkdown(selectedTasks, exportHeading) : tasksToAiPrompt(selectedTasks, exportHeading)
    try {
      await navigator.clipboard.writeText(text)
      setError(null)
      setCopied(kind)
    } catch {
      setError('النسخ منفعش — جرّب Download')
    }
  }

  function download() {
    if (!exportHeading) return
    downloadMarkdown(tasksToMarkdown(selectedTasks, exportHeading), markdownFileName(exportHeading))
  }

  async function move(list: Task[], status: TaskStatus) {
    setMoving(true)
    setError(null)
    try {
      await moveTasksToStatus(list, status)
      toggle(
        list.map((t) => t.id),
        false
      )
    } catch {
      setError('النقل منفعش — ممكن تكون مش متعيّن على بعض التاسكات دي')
    } finally {
      setMoving(false)
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">
        No tasks match these filters yet.
      </div>
    )
  }

  const selectable = !!exportHeading
  const confirmTasks = groups.find((g) => g.status === confirmGroup)?.tasks ?? []
  const confirmTarget = confirmGroup ? nextStatus(confirmGroup) : null

  return (
    <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-6">
      {selectable && selectedTasks.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-accent bg-surface px-3 py-2 shadow-sm">
          <span className="mr-2 text-[12.5px] font-semibold text-text">{selectedTasks.length} selected</span>
          <Select
            size="sm"
            value=""
            disabled={moving}
            onChange={(e) => e.target.value && move(selectedTasks, e.target.value as TaskStatus)}
            aria-label="Move selected tasks to"
          >
            <option value="">{moving ? 'Moving…' : 'Move to…'}</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <span className="mx-1 h-4 w-px bg-border" />
          <button type="button" onClick={() => copy('md')} className={barButtonClass}>
            {copied === 'md' ? 'Copied ✓' : 'Copy MD'}
          </button>
          <button type="button" onClick={download} className={barButtonClass}>
            Download .md
          </button>
          <button
            type="button"
            onClick={() => copy('ai')}
            title="Copies the tasks + instructions — paste into Claude.ai or ChatGPT to get a polished brief"
            className={`${barButtonClass} text-accent`}
          >
            {copied === 'ai' ? 'Copied — paste it in Claude/ChatGPT ✓' : 'Copy AI prompt ✨'}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto rounded-md px-2 py-1.5 text-[12px] text-text-faint hover:bg-field hover:text-text"
          >
            Clear
          </button>
        </div>
      )}

      {error && <p className="text-[12.5px] text-red">{error}</p>}

      <div className="flex items-center gap-3">
        {selectable && (
          <Checkbox
            checked={selectedTasks.length === ordered.length}
            indeterminate={selectedTasks.length > 0 && selectedTasks.length < ordered.length}
            onChange={() =>
              toggle(
                ordered.map((t) => t.id),
                selectedTasks.length !== ordered.length
              )
            }
            label="Select all tasks"
          />
        )}
        <div className={`grid flex-1 ${TASK_GRID} gap-3 px-5 pb-1`}>
          <span className={headerClass}>Task</span>
          <span className={headerClass}>Assignees</span>
          <span className={headerClass}>Priority</span>
          <span className={headerClass}>Status</span>
          <span className={headerClass}>Due</span>
          <span />
        </div>
      </div>

      {groups.map((g) => {
        const ids = g.tasks.map((t) => t.id)
        const picked = ids.filter((id) => selected.has(id)).length
        const next = nextStatus(g.status)
        return (
          <section key={g.status} className="flex flex-col gap-2.5">
            <div className="mt-2 flex items-center gap-3">
              {selectable && (
                <Checkbox
                  checked={picked === ids.length}
                  indeterminate={picked > 0 && picked < ids.length}
                  onChange={() => toggle(ids, picked !== ids.length)}
                  label={`Select all ${STATUS_LABEL[g.status] ?? g.status} tasks`}
                />
              )}
              <StatusPill status={g.status} />
              <span className="text-[12px] text-text-faint">{g.tasks.length}</span>
              {next && (
                <button
                  type="button"
                  disabled={moving}
                  onClick={() => setConfirmGroup(g.status)}
                  className="ml-auto rounded-md px-2 py-1 text-[12px] font-medium text-text-faint hover:bg-field hover:text-text disabled:opacity-60"
                >
                  Move all → {STATUS_LABEL[next]}
                </button>
              )}
            </div>
            {g.tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3">
                {selectable && (
                  <Checkbox
                    checked={selected.has(task.id)}
                    onChange={() => toggle([task.id], !selected.has(task.id))}
                    label={`Select ${task.title}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <TaskRow task={task} to={`${location.pathname}/tasks/${task.id}`} members={members} />
                </div>
              </div>
            ))}
          </section>
        )
      })}

      <ConfirmDialog
        open={!!confirmGroup}
        title={`Move ${confirmTasks.length} task${confirmTasks.length === 1 ? '' : 's'} to ${confirmTarget ? STATUS_LABEL[confirmTarget] : ''}?`}
        message={`Every task shown under ${confirmGroup ? STATUS_LABEL[confirmGroup] : ''} (with the current filters) moves to ${
          confirmTarget ? STATUS_LABEL[confirmTarget] : ''
        }.`}
        confirmLabel="Move all"
        danger={false}
        onConfirm={() => (confirmGroup && confirmTarget ? move(confirmTasks, confirmTarget) : undefined)}
        onClose={() => setConfirmGroup(null)}
      />
    </div>
  )
}
