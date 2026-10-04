import { collection, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'

import type { Member } from '../types/member'
import type { Task } from '../types/task'
import type { ActivityEntry } from '../utils/activity'
import { isOwnerRole } from '../utils/role'
import { STATUS_LABEL } from '../utils/taskStatus'
import { db } from './firebase/app'
import { taskDocRef } from './firebase/refs'

// ── Activity log, written from the browser ─────────────────────────
// Each action that changes data calls logActivity() right after its own
// write succeeds. That one batch writes:
//   1. auditLog/{id}                  — everything, for Admin → Audit Log
//   2. members/{uid}/notifications    — the people who should hear about it
// firestore.rules only accept entries whose actorUid is the signed-in user
// (no logging in someone else's name) and never allow edits or deletes.
//
// Logging is best-effort: a failure here is reported to the console but
// never undoes or blocks the action that already happened.

type EntryFields = Omit<
  ActivityEntry,
  'id' | 'actorUid' | 'actorName' | 'actorInvitedBy' | 'actorInviterRole' | 'seq' | 'createdAt'
>

export interface LogEntry extends EntryFields {
  /** Get a notification of this entry's own type. */
  recipients?: string[]
  /** Get a 'comment.mention' notification instead. */
  mentioned?: string[]
}

interface Actor {
  actorUid: string
  actorName: string
  actorInvitedBy: string | null
  actorInviterRole: string
}

let actor: Actor | null = null

/** Called by AuthProvider whenever the signed-in member changes. The
 * inviter fields must match exactly what firestore.rules derives from the
 * member doc, or the entry is rejected. */
export function setActivityActor(member: Pick<Member, 'uid' | 'displayName' | 'email' | 'role' | 'invitedBy' | 'invitedByRole'> | null) {
  actor = member
    ? {
        actorUid: member.uid,
        actorName: member.displayName || member.email || 'Someone',
        actorInvitedBy: member.invitedBy ?? null,
        actorInviterRole: isOwnerRole(member.role) ? 'none' : (member.invitedByRole ?? 'owner'),
      }
    : null
}

/** Firestore rejects `undefined` field values — drop them. */
function clean<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

export async function logActivity(entries: LogEntry[]) {
  if (!actor || entries.length === 0) return
  const me = actor
  try {
    const batch = writeBatch(db)
    const others = (uids: (string | null | undefined)[]) =>
      [...new Set(uids)].filter((uid): uid is string => !!uid && uid !== me.actorUid)

    // Every entry in one batch gets the SAME server timestamp, so Firestore
    // alone can't tell which came first. `seq` (client clock + position)
    // breaks those ties — see compareNewest() in utils/activity.ts.
    const base = Date.now() * 1000
    for (const [i, { recipients = [], mentioned = [], ...entry }] of entries.entries()) {
      const data = clean({ ...entry, ...me, seq: base + i, createdAt: serverTimestamp() })
      batch.set(doc(collection(db, 'auditLog')), data)

      const mentionUids = others(mentioned)
      const notify = (uid: string, extra: object = {}) =>
        batch.set(doc(collection(db, 'members', uid, 'notifications')), { ...data, ...extra, read: false })
      for (const uid of mentionUids) notify(uid, { type: 'comment.mention' })
      for (const uid of others(recipients).filter((u) => !mentionUids.includes(u))) notify(uid)
    }
    await batch.commit()
  } catch (err) {
    console.error('logActivity:', (err as Error).message)
  }
}

// ── Tasks ────────────────────────────────────────────────────────

export function taskBase(t: Pick<Task, 'id' | 'clientId' | 'projectId' | 'clientName' | 'projectName' | 'title'>) {
  return {
    clientId: t.clientId,
    projectId: t.projectId,
    taskId: t.id,
    clientName: t.clientName || '',
    projectName: t.projectName || '',
    taskTitle: t.title || '',
  }
}

/** Everyone on the task + whoever created it. */
export function taskWatchers(t: Pick<Task, 'assigneeUids' | 'createdBy'>): string[] {
  return [...(t.assigneeUids ?? []), t.createdBy].filter((u): u is string => !!u)
}

function dateStr(v: unknown): string | null {
  const d = v instanceof Date ? v : (v as { toDate?: () => Date } | null)?.toDate?.()
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null
}

function sameList(a: string[] = [], b: string[] = []) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function namesOf(t: Task, uids: string[]) {
  return (t.assignees ?? [])
    .filter((a) => uids.includes(a.uid))
    .map((a) => a.displayName || a.email)
    .join(', ')
}

const label = (s: string | undefined) => STATUS_LABEL[s as keyof typeof STATUS_LABEL] ?? s ?? ''

/** What changed between two versions of a task, as log entries. */
export function taskChangeEntries(before: Task | null, after: Task | null): LogEntry[] {
  const t = (after ?? before)!
  const base = taskBase(t)
  const watchers = taskWatchers(t)

  if (!before) {
    const assignees = after!.assigneeUids ?? []
    return [
      { ...base, type: 'task.created' },
      ...(assignees.length ? [{ ...base, type: 'task.assigned', detail: namesOf(after!, assignees), recipients: assignees }] : []),
    ]
  }
  if (!after) return [{ ...base, type: 'task.deleted', recipients: before.assigneeUids ?? [] }]

  const out: LogEntry[] = []
  if (before.title !== after.title) {
    out.push({ ...base, type: 'task.renamed', from: before.title, to: after.title, recipients: watchers })
  }
  if (before.status !== after.status) {
    out.push({ ...base, type: 'task.status', from: label(before.status), to: label(after.status), recipients: watchers })
  }
  const prev = before.assigneeUids ?? []
  const next = after.assigneeUids ?? []
  const added = next.filter((u) => !prev.includes(u))
  const removed = prev.filter((u) => !next.includes(u))
  if (added.length) out.push({ ...base, type: 'task.assigned', detail: namesOf(after, added), recipients: added })
  if (removed.length) out.push({ ...base, type: 'task.unassigned', detail: namesOf(before, removed), recipients: removed })
  if ((before.priority ?? null) !== (after.priority ?? null)) {
    out.push({ ...base, type: 'task.priority', from: before.priority || 'none', to: after.priority || 'none', recipients: watchers })
  }
  if (dateStr(before.dueDate) !== dateStr(after.dueDate)) {
    out.push({ ...base, type: 'task.due_date', from: dateStr(before.dueDate) ?? 'none', to: dateStr(after.dueDate) ?? 'none', recipients: watchers })
  }
  if (dateStr(before.startDate) !== dateStr(after.startDate)) {
    out.push({ ...base, type: 'task.start_date', from: dateStr(before.startDate) ?? 'none', to: dateStr(after.startDate) ?? 'none' })
  }
  if ((before.description ?? '') !== (after.description ?? '')) {
    out.push({ ...base, type: 'task.description', recipients: watchers })
  }
  if (!sameList(before.tags, after.tags)) {
    out.push({ ...base, type: 'task.tags', from: (before.tags ?? []).join(', '), to: (after.tags ?? []).join(', ') })
  }
  return out
}

/** Update a task and log what changed. Throws if the update itself fails. */
export async function updateTaskLogged(task: Task, patch: Partial<Task>) {
  await updateDoc(taskDocRef(task.clientId, task.projectId, task.id), { ...patch, updatedAt: serverTimestamp() })
  void logActivity(taskChangeEntries(task, { ...task, ...patch }))
}
