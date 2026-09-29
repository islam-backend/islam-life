import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { TopBar } from '../components/layout/TopBar'
import { Avatar } from '../components/ui/Avatar'
import { Select } from '../components/ui/Select'
import { useAuditLog } from '../hooks/useAuditLog'
import { useAuth } from '../hooks/useAuth'
import { useMembers } from '../hooks/useMembers'
import { downloadMarkdown } from '../lib/tasksMarkdown'
import {
  type ActivityCategory,
  type ActivityEntry,
  CATEGORY_LABEL,
  activityLink,
  categoryOf,
  describeActivity,
  groupByDay,
  millisOf,
} from '../utils/activity'
import { isOwnerRole } from '../utils/role'

const inputClass =
  'rounded-lg border border-border bg-field px-3 py-1.5 text-[12.5px] text-text outline-none placeholder:text-text-faint focus:border-accent'

function timeOf(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function toCsv(entries: ActivityEntry[]): string {
  const header = ['time', 'actor', 'event', 'description', 'client', 'project', 'task', 'detail']
  const rows = entries.map((e) => [
    millisOf(e) ? new Date(millisOf(e)).toISOString() : '',
    e.actorName || '',
    e.type,
    describeActivity(e).text,
    e.clientName || '',
    e.projectName || '',
    e.taskTitle || '',
    e.detail || '',
  ])
  // BOM so Excel opens Arabic text correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

/**
 * Everything that happened, who did it, and when. Written by the app with
 * each action (lib/activityLog.ts); rules pin every entry to its real
 * author and forbid edits/deletes.
 * Owner sees everything; a manager sees their clients only (no Team events).
 */
export function AdminAuditLogPage() {
  const { member } = useAuth()
  const isOwner = isOwnerRole(member?.role)
  const { members } = useMembers()
  const { entries, loading, error, hasMore, loadMore } = useAuditLog(member)

  const [category, setCategory] = useState<ActivityCategory | ''>('')
  const [actorUid, setActorUid] = useState('')
  const [clientId, setClientId] = useState('')
  const [search, setSearch] = useState('')

  const actors = useMemo(() => {
    const byUid = new Map<string, string>()
    for (const e of entries) if (e.actorUid) byUid.set(e.actorUid, e.actorName || e.actorUid)
    return Array.from(byUid, ([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [entries])

  const clients = useMemo(() => {
    const byId = new Map<string, string>()
    for (const e of entries) if (e.clientId && e.clientName) byId.set(e.clientId, e.clientName)
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (category && categoryOf(e.type) !== category) return false
      if (actorUid && e.actorUid !== actorUid) return false
      if (clientId && e.clientId !== clientId) return false
      if (q) {
        const hay = [describeActivity(e).text, e.detail, e.clientName, e.projectName, e.taskTitle, e.targetName]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, category, actorUid, clientId, search])

  const avatarFor = (uid?: string | null) => members.find((m) => m.uid === uid)?.avatarUrl
  const categories = (Object.keys(CATEGORY_LABEL) as ActivityCategory[]).filter((c) => isOwner || c !== 'team')

  return (
    <>
      <TopBar
        crumbs={[{ label: 'Admin' }, { label: 'Audit Log' }]}
        actions={
          filtered.length > 0 ? (
            <button
              onClick={() =>
                downloadMarkdown(toCsv(filtered), `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
              }
              className="cursor-pointer text-[12.5px] font-medium text-text-muted hover:text-text"
            >
              Export CSV
            </button>
          ) : undefined
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-6 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className={`${inputClass} w-56`}
        />
        <Select size="sm" value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory | '')}>
          <option value="">All events</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select size="sm" value={actorUid} onChange={(e) => setActorUid(e.target.value)}>
          <option value="">Anyone</option>
          {actors.map((a) => (
            <option key={a.uid} value={a.uid}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select size="sm" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-[12px] text-text-faint">
          {filtered.length} event{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        {error ? (
          <p className="text-[13px] text-red">Couldn't load the audit log: {error}</p>
        ) : loading ? (
          <p className="text-[13px] text-text-faint">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-text-faint">
            {entries.length === 0 ? 'Nothing logged yet — events show up here as people use the app.' : 'No events match these filters.'}
          </p>
        ) : (
          groupByDay(filtered).map((g) => (
            <section key={g.label} className="flex flex-col gap-1.5">
              <h2 dir="rtl" className="text-right text-[11.5px] font-semibold text-text-faint">
                {g.label}
              </h2>
              <div className="overflow-hidden rounded-lg border border-border bg-surface">
                {g.items.map((e, i) => {
                  const { icon, text } = describeActivity(e)
                  const link = activityLink(e)
                  return (
                    <div
                      key={e.id}
                      className={`grid grid-cols-[64px_170px_1fr] items-start gap-3 px-4 py-2.5 ${
                        i > 0 ? 'border-t border-border' : ''
                      }`}
                    >
                      <span className="pt-0.5 text-[12px] tabular-nums text-text-faint">{timeOf(millisOf(e))}</span>
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={e.actorName} imageUrl={avatarFor(e.actorUid)} size={20} colorClass="bg-avatar-b" />
                        <span className="truncate text-[12.5px] text-text-muted">{e.actorName || 'System'}</span>
                      </span>
                      <span dir="rtl" className="flex min-w-0 flex-col gap-0.5 text-right">
                        <span className="text-[13px] text-text">
                          {icon}{' '}
                          {link ? (
                            <Link to={link} className="hover:text-accent hover:underline">
                              {text}
                            </Link>
                          ) : (
                            text
                          )}
                        </span>
                        {(e.detail && e.type.startsWith('comment.')) && (
                          <span dir="auto" className="truncate text-[12px] text-text-muted">
                            “{e.detail}”
                          </span>
                        )}
                        {(e.clientName || e.projectName) && (
                          <span className="text-[11px] text-text-faint">
                            {[e.clientName, e.projectName].filter(Boolean).join(' / ')}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ))
        )}

        {hasMore && !loading && !error && (
          <button
            onClick={loadMore}
            className="mx-auto rounded-md px-4 py-2 text-[12.5px] font-medium text-text-muted hover:bg-field hover:text-text"
          >
            Load older
          </button>
        )}
      </div>
    </>
  )
}
