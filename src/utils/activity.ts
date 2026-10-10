/**
 * One activity event, as written by lib/activityLog.ts into both
 * auditLog/{id} and members/{uid}/notifications/{id}. Legacy 'assigned'
 * notifications carry no actor fields.
 */
export interface ActivityEntry {
  id: string
  type: string
  actorUid?: string | null
  actorName?: string
  /** Who invited the actor, and that inviter's role ('none' when the actor
   * is an owner). Drives what a manager may read — see firestore.rules. */
  actorInvitedBy?: string | null
  actorInviterRole?: string
  clientId?: string
  clientName?: string
  projectId?: string
  projectName?: string
  taskId?: string
  taskTitle?: string
  commentId?: string
  memberUid?: string
  targetName?: string
  from?: string
  to?: string
  detail?: string
  /** comment.* — text / voice / image / file */
  kind?: string
  /** Tie-breaker for entries written in the same batch (same createdAt). */
  seq?: number
  createdAt?: { toMillis?: () => number; toDate?: () => Date } | null
}

export type ActivityCategory = 'tasks' | 'chat' | 'files' | 'workspace' | 'team'

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  tasks: 'Tasks',
  chat: 'Chat',
  files: 'Files',
  workspace: 'Clients & projects',
  team: 'Team',
}

export function categoryOf(type: string): ActivityCategory {
  if (type === 'assigned' || type.startsWith('task.')) return 'tasks'
  if (type.startsWith('comment.')) return 'chat'
  if (type.startsWith('attachment.') || type.startsWith('proof.')) return 'files'
  if (type.startsWith('client.') || type.startsWith('project.')) return 'workspace'
  return 'team'
}

const PRIORITY_AR: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'بدون',
}

function dateAr(v: string | undefined): string {
  if (!v || v === 'none') return 'بدون'
  const d = new Date(`${v}T00:00:00`)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
}

const ROLE_AR: Record<string, string> = { owner: 'Owner', manager: 'Manager', member: 'Member' }

/**
 * Human sentence for an event. `forMe` phrases it from the reader's side
 * where it matters ("عيّنك" instead of "عيّن فلان").
 */
export function describeActivity(e: ActivityEntry, forMe = false): { icon: string; text: string } {
  const who = e.actorName || 'حد'
  const task = `«${e.taskTitle || 'تاسك'}»`
  switch (e.type) {
    case 'assigned':
      return { icon: '📋', text: `اتعيّنت على ${task}` }
    case 'task.created':
      return { icon: '🆕', text: `${who} عمل تاسك جديدة ${task}` }
    case 'task.deleted':
      return { icon: '🗑️', text: `${who} مسح التاسك ${task}` }
    case 'task.renamed':
      return { icon: '✏️', text: `${who} غيّر اسم التاسك من «${e.from}» لـ «${e.to}»` }
    case 'task.status':
      return {
        icon: e.to === 'Done' ? '✅' : '🔄',
        text: `${who} غيّر حالة ${task} من ${e.from} لـ ${e.to}`,
      }
    case 'task.assigned':
      return { icon: '👤', text: forMe ? `${who} عيّنك على ${task}` : `${who} عيّن ${e.detail} على ${task}` }
    case 'task.unassigned':
      return { icon: '👋', text: forMe ? `${who} شالك من ${task}` : `${who} شال ${e.detail} من ${task}` }
    case 'task.priority':
      return { icon: '🚩', text: `${who} غيّر أولوية ${task} من ${PRIORITY_AR[e.from ?? ''] ?? e.from} لـ ${PRIORITY_AR[e.to ?? ''] ?? e.to}` }
    case 'task.due_date':
      return { icon: '📅', text: `${who} غيّر ميعاد تسليم ${task} من ${dateAr(e.from)} لـ ${dateAr(e.to)}` }
    case 'task.start_date':
      return { icon: '📅', text: `${who} غيّر ميعاد بداية ${task} من ${dateAr(e.from)} لـ ${dateAr(e.to)}` }
    case 'task.description':
      return { icon: '📝', text: `${who} عدّل وصف ${task}` }
    case 'task.tags':
      return { icon: '🏷️', text: `${who} غيّر تاجز ${task}${e.to ? ` لـ ${e.to}` : ''}` }
    case 'comment.created': {
      const what = e.kind === 'voice' ? 'بعت رسالة صوتية' : e.kind === 'image' ? 'بعت صورة' : e.kind === 'file' ? 'بعت ملف' : 'كتب رسالة'
      return { icon: e.kind === 'voice' ? '🎙️' : '💬', text: `${who} ${what} في ${task}` }
    }
    case 'comment.mention':
      return { icon: '📣', text: forMe ? `${who} عمل لك منشن في ${task}` : `${who} عمل منشن في ${task}` }
    case 'comment.reaction':
      return {
        icon: e.to || '👍',
        text: forMe ? `${who} تفاعل ${e.to || ''} على رسالتك في ${task}` : `${who} تفاعل ${e.to || ''} على رسالة في ${task}`,
      }
    case 'attachment.added':
      return { icon: '📎', text: `${who} رفع ملف «${e.detail}» على ${task}` }
    case 'attachment.deleted':
      return { icon: '🗑️', text: `${who} مسح الملف «${e.detail}» من ${task}` }
    case 'proof.added':
      return { icon: '📸', text: `${who} رفع سكرين شوت إن ${task} خلصت` }
    case 'proof.deleted':
      return { icon: '🗑️', text: `${who} مسح سكرين شوت الإثبات من ${task}` }
    case 'client.created':
      return { icon: '🏢', text: `${who} ضاف عميل جديد «${e.clientName}»` }
    case 'client.renamed':
      return { icon: '✏️', text: `${who} غيّر اسم العميل من «${e.from}» لـ «${e.to}»` }
    case 'client.deleted':
      return { icon: '🗑️', text: `${who} مسح العميل «${e.clientName}»` }
    case 'project.created':
      return { icon: '📁', text: `${who} عمل مشروع جديد «${e.projectName}» لـ ${e.clientName}` }
    case 'project.renamed':
      return { icon: '✏️', text: `${who} غيّر اسم المشروع من «${e.from}» لـ «${e.to}»` }
    case 'project.deleted':
      return { icon: '🗑️', text: `${who} مسح المشروع «${e.projectName}»` }
    case 'member.joined':
      return { icon: '🎉', text: `${e.targetName} دخل الفريق كـ ${ROLE_AR[e.to ?? ''] ?? e.to}` }
    case 'member.removed':
      return { icon: '🚪', text: `${who} شال ${e.targetName} من الفريق` }
    case 'member.role':
      return {
        icon: '🔑',
        text: forMe
          ? `${who} غيّر دورك من ${ROLE_AR[e.from ?? ''] ?? e.from} لـ ${ROLE_AR[e.to ?? ''] ?? e.to}`
          : `${who} غيّر دور ${e.targetName} من ${ROLE_AR[e.from ?? ''] ?? e.from} لـ ${ROLE_AR[e.to ?? ''] ?? e.to}`,
      }
    case 'member.access':
      return { icon: '🔐', text: forMe ? `${who} عدّل المشاريع اللي تقدر تشوفها` : `${who} عدّل صلاحيات ${e.targetName}` }
    case 'invite.created':
      return { icon: '✉️', text: `${who} بعت دعوة لـ ${e.targetName} كـ ${ROLE_AR[e.to ?? ''] ?? e.to}` }
    case 'invite.revoked':
      return { icon: '✉️', text: `${who} لغى دعوة ${e.targetName}` }
    default:
      return { icon: '•', text: `${who} · ${e.type}` }
  }
}

/** Before → after, formatted for display, for events that change a value. */
export function changeOf(e: ActivityEntry): { label: string; from: string; to: string } | null {
  const prio = (v?: string) => PRIORITY_AR[v ?? ''] ?? v ?? ''
  const role = (v?: string) => ROLE_AR[v ?? ''] ?? v ?? ''
  const from = e.from ?? ''
  const to = e.to ?? ''
  switch (e.type) {
    case 'task.renamed':
      return { label: 'الاسم', from, to }
    case 'task.status':
      return { label: 'الحالة', from, to }
    case 'task.priority':
      return { label: 'الأولوية', from: prio(from), to: prio(to) }
    case 'task.due_date':
      return { label: 'ميعاد التسليم', from: dateAr(from), to: dateAr(to) }
    case 'task.start_date':
      return { label: 'ميعاد البداية', from: dateAr(from), to: dateAr(to) }
    case 'task.tags':
      return { label: 'التاجز', from: from || 'بدون', to: to || 'بدون' }
    case 'client.renamed':
    case 'project.renamed':
      return { label: 'الاسم', from, to }
    case 'member.role':
      return { label: 'الدور', from: role(from), to: role(to) }
    default:
      return null
  }
}

/** Short sentence for the Audit Log — the before/after is shown separately
 * as chips, so it isn't repeated here. */
export function auditHeadline(e: ActivityEntry): string {
  const who = e.actorName || 'حد'
  const task = `«${e.taskTitle || 'تاسك'}»`
  switch (e.type) {
    case 'task.renamed':
      return `${who} غيّر اسم التاسك`
    case 'task.status':
      return `${who} غيّر حالة ${task}`
    case 'task.priority':
      return `${who} غيّر أولوية ${task}`
    case 'task.due_date':
      return `${who} غيّر ميعاد تسليم ${task}`
    case 'task.start_date':
      return `${who} غيّر ميعاد بداية ${task}`
    case 'task.tags':
      return `${who} غيّر تاجز ${task}`
    case 'client.renamed':
      return `${who} غيّر اسم العميل`
    case 'project.renamed':
      return `${who} غيّر اسم المشروع`
    case 'member.role':
      return `${who} غيّر دور ${e.targetName}`
    default:
      return describeActivity(e).text
  }
}

/** Where clicking an event should take you, if anywhere. */
export function activityLink(e: ActivityEntry): string | null {
  // The task / project / client itself is gone — nothing to open.
  if (['task.deleted', 'project.deleted', 'client.deleted'].includes(e.type)) return null
  if (e.taskId && e.clientId && e.projectId) {
    const base = `/clients/${e.clientId}/projects/${e.projectId}/tasks/${e.taskId}`
    return e.type.startsWith('comment.') ? `${base}#chat` : base
  }
  if (e.projectId && e.clientId) return `/clients/${e.clientId}/projects/${e.projectId}`
  if (e.type.startsWith('member.') || e.type.startsWith('invite.')) return '/admin/team'
  return null
}

export function millisOf(e: ActivityEntry): number {
  return e.createdAt?.toMillis?.() ?? 0
}

/** Newest first. Entries logged together share one server timestamp, so
 * `seq` (their order within the batch) decides among them. */
export function compareNewest(a: ActivityEntry, b: ActivityEntry): number {
  return millisOf(b) - millisOf(a) || (b.seq ?? 0) - (a.seq ?? 0)
}

export function relativeTimeAr(ms: number): string {
  if (!ms) return ''
  const mins = Math.floor((Date.now() - ms) / 60_000)
  if (mins < 1) return 'الآن'
  if (mins < 60) return `منذ ${mins} د`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `منذ ${hrs} س`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `منذ ${days} ي`
  return new Date(ms).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
}

/** "النهارده" / "امبارح" / a date — for grouping lists by day. */
export function dayLabelAr(ms: number): string {
  if (!ms) return 'دلوقتي'
  const d = new Date(ms)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diff === 0) return 'النهارده'
  if (diff === 1) return 'امبارح'
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Split an already-sorted (newest first) list into day groups. */
export function groupByDay<T extends ActivityEntry>(items: T[]): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = []
  for (const item of items) {
    const label = dayLabelAr(millisOf(item))
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
