import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { TopBar } from '../components/layout/TopBar'
import { PriorityPill } from '../components/tasks/PriorityPill'
import { TagList } from '../components/tasks/TagList'
import { Button } from '../components/ui/Button'
import { useAllTasks } from '../hooks/useAllTasks'
import { useAuth } from '../hooks/useAuth'
import { useMembers } from '../hooks/useMembers'
import { restoreTasks } from '../lib/firebase/archive'
import type { Task } from '../types/task'
import { isOwnerRole } from '../utils/role'
import { originState } from '../utils/taskOrigin'
import { STATUS_LABEL } from '../utils/taskStatus'

const GRID = 'grid-cols-[28px_1.4fr_1fr_100px_110px_1fr_90px]'
const headerClass = 'text-[11.5px] font-semibold uppercase tracking-wide text-text-faint'
const checkboxClass = 'h-4 w-4 shrink-0 cursor-pointer accent-accent'

function toDate(ts: unknown): Date | null {
  return (ts as { toDate?: () => Date } | null)?.toDate?.() ?? null
}

/**
 * Admin → Archive: every archived task the viewer can manage (owner: all,
 * manager: their clients). The only place archived tasks show up — restore
 * sends a task back to the status it had before it was archived.
 */
export function ArchivedTasksPage() {
  const { member } = useAuth()
  const isOwner = isOwnerRole(member?.role)
  const managedClientIds = member?.managedClientIds ?? []
  const { tasks, loading } = useAllTasks(
    isOwner || managedClientIds.length > 0,
    isOwner ? undefined : managedClientIds,
    true
  )
  const { members } = useMembers()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameOf = (uid: string | null | undefined) => {
    const m = members.find((x) => x.uid === uid)
    return m?.displayName || m?.email || '—'
  }

  // Most recently archived first.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks
      .filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          t.clientName?.toLowerCase().includes(q) ||
          t.projectName?.toLowerCase().includes(q)
      )
      .sort((a, b) => (toDate(b.archivedAt)?.getTime() ?? 0) - (toDate(a.archivedAt)?.getTime() ?? 0))
  }, [tasks, search])

  const selectedTasks = visible.filter((t) => selected.has(t.id))

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

  async function restore(list: Task[]) {
    setBusy(true)
    setError(null)
    try {
      await restoreTasks(list)
      toggle(
        list.map((t) => t.id),
        false
      )
    } catch {
      setError('الاسترجاع منفعش — جرّب تاني')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'Archive' }]} />
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search archived tasks…"
          className="w-72 rounded-lg border border-border bg-field px-3 py-1.5 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
        <span className="text-[12.5px] text-text-faint">
          {visible.length} archived task{visible.length === 1 ? '' : 's'}
        </span>
        {selectedTasks.length > 0 && (
          <Button className="ml-auto" disabled={busy} onClick={() => restore(selectedTasks)}>
            {busy ? 'Restoring…' : `Restore ${selectedTasks.length} selected`}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <p className="mb-3 text-[12.5px] text-red">{error}</p>}

        {loading ? (
          <p className="text-[13px] text-text-faint">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="pt-10 text-center text-[13px] text-text-faint">
            {tasks.length === 0 ? 'Nothing archived yet.' : 'No archived tasks match that search.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className={`grid ${GRID} items-center gap-3 bg-field px-5 py-2.5`}>
              <input
                type="checkbox"
                checked={selectedTasks.length === visible.length}
                onChange={() =>
                  toggle(
                    visible.map((t) => t.id),
                    selectedTasks.length !== visible.length
                  )
                }
                aria-label="Select all archived tasks"
                className={checkboxClass}
              />
              <span className={headerClass}>Task</span>
              <span className={headerClass}>Client / Project</span>
              <span className={headerClass}>Priority</span>
              <span className={headerClass}>Was</span>
              <span className={headerClass}>Archived</span>
              <span />
            </div>

            {visible.map((task, i) => {
              const archivedOn = toDate(task.archivedAt)
              return (
                <div
                  key={task.id}
                  className={`grid ${GRID} items-center gap-3 px-5 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onChange={(e) => toggle([task.id], e.target.checked)}
                    aria-label={`Select ${task.title}`}
                    className={checkboxClass}
                  />
                  <span className="flex min-w-0 flex-col gap-1 pr-3">
                    <Link
                      dir="auto"
                      to={`/clients/${task.clientId}/projects/${task.projectId}/tasks/${task.id}`}
                      state={originState('Archive', '/admin/archive')}
                      className="truncate text-[13px] font-medium text-text hover:text-accent"
                    >
                      {task.title}
                    </Link>
                    <TagList tags={task.tags} />
                  </span>
                  <span className="truncate text-[13px] text-text-muted">
                    {task.clientName} / {task.projectName}
                  </span>
                  <PriorityPill priority={task.priority} />
                  <span className="text-[12.5px] text-text-muted">
                    {task.archivedFrom ? (STATUS_LABEL[task.archivedFrom] ?? task.archivedFrom) : '—'}
                  </span>
                  <span className="truncate text-[12.5px] text-text-muted">
                    {archivedOn
                      ? archivedOn.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                      : '—'}
                    {task.archivedBy ? ` · ${nameOf(task.archivedBy)}` : ''}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => restore([task])}
                    className="cursor-pointer justify-self-end text-[12.5px] font-semibold text-accent hover:underline disabled:opacity-50"
                  >
                    Restore
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
