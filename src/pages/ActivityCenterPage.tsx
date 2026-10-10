import { type ReactNode, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { TopBar } from '../components/layout/TopBar'
import { Avatar } from '../components/ui/Avatar'
import { useAuditLog } from '../hooks/useAuditLog'
import { useAuth } from '../hooks/useAuth'
import { useMembers } from '../hooks/useMembers'
import { type AppNotification, useNotifications } from '../hooks/useNotifications'
import { downloadMarkdown } from '../lib/tasksMarkdown'
import {
  type ActivityCategory,
  type ActivityEntry,
  activityLink,
  auditHeadline,
  categoryOf,
  changeOf,
  describeActivity,
  groupByDay,
  millisOf,
  relativeTimeAr,
} from '../utils/activity'
import { isAdminRole, isOwnerRole } from '../utils/role'
import { originState } from '../utils/taskOrigin'

// ── Shared pieces ────────────────────────────────────────────────

const CATEGORY_AR: Record<ActivityCategory, string> = {
  tasks: 'التاسكات',
  chat: 'الشات',
  files: 'الملفات والإثباتات',
  workspace: 'العملاء والمشاريع',
  team: 'الفريق',
}

function timeOf(ms: number): string {
  return ms ? new Date(ms).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' }) : ''
}

interface RailItem {
  value: string
  label: string
  count: number
  avatar?: { name: string; url?: string }
}

/** The filter column on the side of the page. */
function FilterRail({
  sections,
  value,
  onChange,
}: {
  sections: { title?: string; items: RailItem[] }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-4">
      {sections
        .filter((s) => s.items.length > 0)
        .map((s, i) => (
          <div key={s.title ?? i} className="flex flex-col gap-0.5">
            {s.title && <span className="px-2 pb-1 text-[11px] font-semibold text-text-faint">{s.title}</span>}
            {s.items.map((item) => {
              const active = value === item.value
              return (
                <button
                  key={item.value}
                  onClick={() => onChange(active && item.value !== 'all' ? 'all' : item.value)}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-right text-[13px] ${
                    active ? 'bg-accent-tint font-semibold text-accent-tint-text' : 'text-text-muted hover:bg-field hover:text-text'
                  }`}
                >
                  {item.avatar && <Avatar name={item.avatar.name} imageUrl={item.avatar.url} size={18} colorClass="bg-avatar-b" />}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count > 0 && <span className="text-[11.5px] tabular-nums text-text-faint">{item.count}</span>}
                </button>
              )
            })}
          </div>
        ))}
    </aside>
  )
}

/** One event, full width: what happened, message preview, who/where, when. */
function ActivityRow({
  entry,
  forMe,
  unread = false,
  avatarUrl,
  onOpen,
}: {
  entry: ActivityEntry
  forMe: boolean
  unread?: boolean
  avatarUrl?: string
  onOpen: () => void
}) {
  const { icon, text } = describeActivity(entry, forMe)
  const link = activityLink(entry)
  const ms = millisOf(entry)
  const where = [entry.clientName, entry.projectName].filter(Boolean).join(' / ')
  return (
    <button
      onClick={onOpen}
      className={`group flex w-full items-start gap-4 px-5 py-3.5 text-right transition-colors ${
        link ? 'cursor-pointer hover:bg-field' : 'cursor-default'
      } ${unread ? 'bg-accent-tint/25' : ''}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-field text-[16px]">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={`text-[13.5px] leading-snug ${unread ? 'font-semibold text-text' : 'text-text'}`}>{text}</span>
        {entry.detail && entry.type.startsWith('comment.') && (
          <span
            dir="auto"
            className="line-clamp-2 w-fit max-w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-[12.5px] text-text-muted"
          >
            {entry.detail}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-faint">
          {entry.actorName && (
            <span className="flex items-center gap-1.5">
              <Avatar name={entry.actorName} imageUrl={avatarUrl} size={16} colorClass="bg-avatar-b" />
              {entry.actorName}
            </span>
          )}
          {where && <span className="rounded bg-field px-1.5 py-0.5">{where}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
        <span className="text-[11.5px] text-text-faint" title={ms ? new Date(ms).toLocaleString('ar-EG') : ''}>
          {relativeTimeAr(ms)}
        </span>
        <span className="text-[11px] tabular-nums text-text-faint">{timeOf(ms)}</span>
        {unread && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
    </button>
  )
}

function Feed<T extends ActivityEntry>({
  items,
  loading,
  empty,
  hasMore,
  onMore,
  renderRow,
  header,
}: {
  items: T[]
  loading: boolean
  empty: string
  hasMore: boolean
  onMore: () => void
  renderRow: (item: T) => ReactNode
  header?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      {header}
      {loading ? (
        <p className="text-[13px] text-text-faint">Loading…</p>
      ) : items.length === 0 ? (
        <p className="py-20 text-center text-[13.5px] text-text-faint">{empty}</p>
      ) : (
        groupByDay(items).map((g) => (
          <section key={g.label} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 px-1 text-[12px] font-semibold text-text-muted">
              {g.label}
              <span className="font-normal text-text-faint">· {g.items.length}</span>
            </h2>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {g.items.map((item) => (
                <div key={item.id}>{renderRow(item)}</div>
              ))}
            </div>
          </section>
        ))
      )}
      {hasMore && !loading && (
        <button
          onClick={onMore}
          className="mx-auto rounded-md px-4 py-2 text-[12.5px] font-medium text-text-muted hover:bg-field hover:text-text"
        >
          عرض أقدم
        </button>
      )}
    </div>
  )
}

// ── Tab: my notifications ────────────────────────────────────────

function NotificationsTab({ avatarFor }: { avatarFor: (uid?: string | null) => string | undefined }) {
  const { notifications, loading, unreadCount, hasMore, loadMore, markRead, markAllRead } = useNotifications(100)
  const [filter, setFilter] = useState('all')
  const navigate = useNavigate()

  const count = (pred: (n: AppNotification) => boolean) => notifications.filter(pred).length
  const matches = (n: AppNotification, f: string) =>
    f === 'all'
      ? true
      : f === 'unread'
        ? !n.read
        : f === 'mentions'
          ? n.type === 'comment.mention'
          : categoryOf(n.type) === f
  const visible = useMemo(() => notifications.filter((n) => matches(n, filter)), [notifications, filter])

  async function open(n: AppNotification) {
    if (!n.read) await markRead(n.id)
    const to = activityLink(n)
    if (to) navigate(to, { state: originState('Notifications', '/notifications') })
  }

  return (
    <div className="flex min-h-0 flex-1">
      <FilterRail
        value={filter}
        onChange={setFilter}
        sections={[
          {
            items: [
              { value: 'all', label: 'الكل', count: notifications.length },
              { value: 'unread', label: 'مش مقروءة', count: unreadCount },
              { value: 'mentions', label: 'منشن ليك', count: count((n) => n.type === 'comment.mention') },
            ],
          },
          {
            title: 'النوع',
            items: (['tasks', 'chat', 'files', 'team'] as ActivityCategory[]).map((c) => ({
              value: c,
              label: CATEGORY_AR[c],
              count: count((n) => categoryOf(n.type) === c),
            })),
          },
        ]}
      />
      <Feed
        items={visible}
        loading={loading}
        hasMore={hasMore}
        onMore={loadMore}
        empty={filter === 'unread' ? 'مفيش إشعارات جديدة 🎉' : 'مفيش إشعارات هنا لسه.'}
        header={
          unreadCount > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-5 py-3">
              <span className="text-[13px] text-text">
                عندك <b>{unreadCount}</b> إشعار مش مقروء
              </span>
              <button onClick={markAllRead} className="text-[12.5px] font-medium text-accent hover:underline">
                تحديد الكل كمقروء
              </button>
            </div>
          )
        }
        renderRow={(n) => (
          <ActivityRow entry={n} forMe unread={!n.read} avatarUrl={avatarFor(n.actorUid)} onOpen={() => open(n)} />
        )}
      />
    </div>
  )
}

// ── Tab: audit log (owner / manager) ─────────────────────────────

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

const CATEGORY_STYLE: Record<ActivityCategory, { chip: string; dot: string }> = {
  tasks: { chip: 'bg-accent-tint text-accent-tint-text', dot: 'bg-accent' },
  chat: { chip: 'bg-violet-tint text-violet-tint-text', dot: 'bg-violet' },
  files: { chip: 'bg-cyan-tint text-cyan-tint-text', dot: 'bg-cyan' },
  workspace: { chip: 'bg-amber-tint text-amber-tint-text', dot: 'bg-amber' },
  team: { chip: 'bg-green-tint text-green-tint-text', dot: 'bg-green' },
}

type Period = 'all' | 'today' | '7d' | '30d'
const PERIOD_AR: Record<Period, string> = { all: 'الكل', today: 'النهارده', '7d': 'آخر 7 أيام', '30d': 'آخر 30 يوم' }
const PERIOD_MS: Record<Exclude<Period, 'all' | 'today'>, number> = { '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** One audit event as a structured card: who · what · before→after · where · when. */
function AuditRow({
  entry,
  avatarUrl,
  onOpen,
}: {
  entry: ActivityEntry
  avatarUrl?: string
  onOpen: () => void
}) {
  const { icon } = describeActivity(entry)
  const category = categoryOf(entry.type)
  const style = CATEGORY_STYLE[category]
  const link = activityLink(entry)
  const ms = millisOf(entry)
  const change = changeOf(entry)
  const who = entry.actorName || 'حد'
  const headline = auditHeadline(entry)
  const rest = headline.startsWith(who) ? headline.slice(who.length) : null
  const crumbs = [
    entry.clientName && { icon: '🏢', text: entry.clientName },
    entry.projectName && { icon: '📁', text: entry.projectName },
    entry.taskTitle && { icon: '☑️', text: entry.taskTitle },
  ].filter((c): c is { icon: string; text: string } => !!c)

  return (
    <button
      onClick={onOpen}
      className={`flex w-full items-start gap-4 px-5 py-4 text-right transition-colors ${
        link ? 'cursor-pointer hover:bg-field' : 'cursor-default'
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[18px] ${style.chip}`}>{icon}</span>

      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-[14px] leading-snug text-text">
          {rest !== null ? (
            <>
              <b className="font-semibold">{who}</b>
              {rest}
            </>
          ) : (
            headline
          )}
        </span>

        {change && (
          <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-text-faint">{change.label}:</span>
            <span className="rounded-md bg-red-tint px-2 py-0.5 text-red-tint-text line-through decoration-1">
              {change.from || '—'}
            </span>
            <span className="text-text-faint">←</span>
            <span className="rounded-md bg-green-tint px-2 py-0.5 font-semibold text-green-tint-text">{change.to || '—'}</span>
          </span>
        )}

        {entry.type === 'task.assigned' || entry.type === 'task.unassigned' ? (
          entry.detail && (
            <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-text-faint">{entry.type === 'task.assigned' ? 'اتعيّن:' : 'اتشال:'}</span>
              <span className="rounded-md bg-field px-2 py-0.5 font-medium text-text">{entry.detail}</span>
            </span>
          )
        ) : (
          entry.detail &&
          !change &&
          (entry.type.startsWith('comment.') || entry.type.startsWith('attachment.')) && (
            <span
              dir="auto"
              className="line-clamp-2 w-fit max-w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-[12.5px] text-text-muted"
            >
              {entry.type === 'comment.reaction' && entry.to ? `${entry.to}  ` : ''}
              {entry.detail}
            </span>
          )
        )}

        {crumbs.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-text-faint">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span>›</span>}
                <span className="rounded-md bg-field px-1.5 py-0.5 text-text-muted">
                  {c.icon} {c.text}
                </span>
              </span>
            ))}
          </span>
        )}
      </span>

      <span className="flex w-36 shrink-0 flex-col items-end gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${style.chip}`}>{CATEGORY_AR[category]}</span>
        <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
          <Avatar name={who} imageUrl={avatarUrl} size={18} colorClass="bg-avatar-b" />
          <span className="max-w-[100px] truncate">{who}</span>
        </span>
        <span className="text-[11.5px] text-text-faint" title={ms ? new Date(ms).toLocaleString('ar-EG') : ''}>
          {relativeTimeAr(ms)} · {timeOf(ms)}
        </span>
      </span>
    </button>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3">
      <span className="text-[11.5px] text-text-faint">{label}</span>
      <span className="truncate text-[20px] font-semibold tabular-nums text-text">{value}</span>
      {hint && <span className="truncate text-[11px] text-text-faint">{hint}</span>}
    </div>
  )
}

function AuditLogTab({ avatarFor }: { avatarFor: (uid?: string | null) => string | undefined }) {
  const { member } = useAuth()
  const isOwner = isOwnerRole(member?.role)
  const { entries, loading, error, hasMore, loadMore } = useAuditLog(member)
  const navigate = useNavigate()
  // One rail, three kinds of filter: "cat:tasks", "who:<uid>", "client:<id>".
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('all')

  const people = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>()
    for (const e of entries) {
      if (!e.actorUid) continue
      const cur = m.get(e.actorUid)
      if (cur) cur.count++
      else m.set(e.actorUid, { name: e.actorName || 'Someone', count: 1 })
    }
    return Array.from(m, ([uid, v]) => ({ uid, ...v })).sort((a, b) => b.count - a.count)
  }, [entries])

  const clients = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>()
    for (const e of entries) {
      if (!e.clientId) continue
      const cur = m.get(e.clientId)
      if (cur) cur.count++
      else m.set(e.clientId, { name: e.clientName || e.clientId, count: 1 })
    }
    return Array.from(m, ([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count)
  }, [entries])

  const categoryCounts = useMemo(() => {
    const m = new Map<ActivityCategory, number>()
    for (const e of entries) m.set(categoryOf(e.type), (m.get(categoryOf(e.type)) ?? 0) + 1)
    return m
  }, [entries])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const [kind, val] = filter.split(':')
    const since = period === 'all' ? 0 : period === 'today' ? startOfToday() : Date.now() - PERIOD_MS[period]
    return entries.filter((e) => {
      if (since && millisOf(e) < since) return false
      if (kind === 'cat' && categoryOf(e.type) !== val) return false
      if (kind === 'who' && e.actorUid !== val) return false
      if (kind === 'client' && e.clientId !== val) return false
      if (q) {
        const hay = [describeActivity(e).text, e.detail, e.actorName, e.clientName, e.projectName, e.taskTitle, e.targetName]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, filter, search, period])

  const stats = useMemo(() => {
    const today = startOfToday()
    const actors = new Map<string, { name: string; n: number }>()
    let todayCount = 0
    for (const e of visible) {
      if (millisOf(e) >= today) todayCount++
      if (!e.actorUid) continue
      const cur = actors.get(e.actorUid)
      if (cur) cur.n++
      else actors.set(e.actorUid, { name: e.actorName || 'حد', n: 1 })
    }
    const top = [...actors.values()].sort((a, b) => b.n - a.n)[0]
    return { todayCount, people: actors.size, top }
  }, [visible])

  const categories = (Object.keys(CATEGORY_AR) as ActivityCategory[]).filter((c) => isOwner || c !== 'team')

  if (error) return <p className="p-6 text-[13px] text-red">مقدرتش أحمّل الـ Audit Log: {error}</p>

  return (
    <div className="flex min-h-0 flex-1">
      <FilterRail
        value={filter}
        onChange={setFilter}
        sections={[
          { items: [{ value: 'all', label: 'كل الأحداث', count: entries.length }] },
          {
            title: 'النوع',
            items: categories.map((c) => ({ value: `cat:${c}`, label: CATEGORY_AR[c], count: categoryCounts.get(c) ?? 0 })),
          },
          {
            title: 'مين عمل',
            items: people.map((p) => ({
              value: `who:${p.uid}`,
              label: p.name,
              count: p.count,
              avatar: { name: p.name, url: avatarFor(p.uid) },
            })),
          },
          {
            title: 'العميل',
            items: clients.map((c) => ({ value: `client:${c.id}`, label: c.name, count: c.count })),
          },
        ]}
      />
      <Feed
        items={visible}
        loading={loading}
        hasMore={hasMore}
        onMore={loadMore}
        empty={entries.length === 0 ? 'لسه مفيش أحداث — هتظهر هنا أول ما الفريق يشتغل.' : 'مفيش أحداث بالفلتر ده.'}
        header={
          <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="الأحداث المعروضة" value={visible.length} hint={period === 'all' ? 'من المحمّل لحد دلوقتي' : PERIOD_AR[period]} />
            <StatCard label="أحداث النهارده" value={stats.todayCount} />
            <StatCard label="ناس نشطة" value={stats.people} />
            <StatCard label="الأنشط" value={stats.top?.name ?? '—'} hint={stats.top ? `${stats.top.n} حدث` : undefined} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="دوّر في السجل… (تاسك، شخص، عميل، كلام)"
              className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent"
            />
            <div className="flex overflow-hidden rounded-lg border border-border bg-surface">
              {(Object.keys(PERIOD_AR) as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-2 text-[12.5px] ${
                    period === p ? 'bg-accent-tint font-semibold text-accent-tint-text' : 'text-text-muted hover:bg-field'
                  }`}
                >
                  {PERIOD_AR[p]}
                </button>
              ))}
            </div>
            {visible.length > 0 && (
              <button
                onClick={() =>
                  downloadMarkdown(
                    toCsv(visible),
                    `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
                    'text/csv;charset=utf-8'
                  )
                }
                className="rounded-lg border border-border px-3 py-2 text-[12.5px] font-medium text-text-muted hover:bg-field hover:text-text"
              >
                Export CSV
              </button>
            )}
          </div>
          </>
        }
        renderRow={(e) => (
          <AuditRow
            entry={e}
            avatarUrl={avatarFor(e.actorUid)}
            onOpen={() => {
              const to = activityLink(e)
              if (to) navigate(to, { state: originState('Audit Log', '/notifications/audit-log') })
            }}
          />
        )}
      />
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────

/**
 * One full page for everything that happens: my notifications for
 * everyone, plus the Audit Log tab for owner / managers.
 */
export function ActivityCenterPage({ tab }: { tab: 'notifications' | 'audit' }) {
  const { member } = useAuth()
  const isAdmin = isAdminRole(member?.role)
  const { members } = useMembers()
  const { unreadCount } = useNotifications(100)
  const avatarFor = (uid?: string | null) => members.find((m) => m.uid === uid)?.avatarUrl

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-[13.5px] ${
      isActive ? 'border-accent font-semibold text-text' : 'border-transparent text-text-muted hover:text-text'
    }`

  return (
    <>
      <TopBar crumbs={[{ label: tab === 'audit' ? 'Audit Log' : 'Notifications' }]} />
      <div dir="rtl" className="flex min-h-0 flex-1 flex-col">
        <nav className="flex shrink-0 gap-6 border-b border-border bg-surface px-6 pt-3">
          <NavLink to="/notifications" end className={tabClass}>
            الإشعارات
            {unreadCount > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-bold leading-[16px] text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
          {isAdmin && (
            <NavLink to="/notifications/audit-log" className={tabClass}>
              سجل النشاط (Audit Log)
            </NavLink>
          )}
        </nav>
        {tab === 'audit' && isAdmin ? <AuditLogTab avatarFor={avatarFor} /> : <NotificationsTab avatarFor={avatarFor} />}
      </div>
    </>
  )
}

