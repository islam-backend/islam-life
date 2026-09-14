import {
  type Unsubscribe,
  collection,
  collectionGroup,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { useEffect, useRef } from 'react'

import { db } from '../lib/firebase/app'
import { playPing, showMessageNotification } from '../lib/notify'
import type { TaskStatus } from '../types/task'
import { isAdminRole, isOwnerRole } from '../utils/role'
import { useAllTasks } from './useAllTasks'
import { useAuth } from './useAuth'
import { useMyTasks } from './useMyTasks'

interface LatestComment {
  id: string
  authorUid?: string
  authorName?: string
  text?: string
  imageUrl?: string
  mentions?: string[]
  createdAt?: { toMillis?: () => number }
}

/**
 * Sound + (when the tab is hidden) a browser notification for:
 *  - a new chat message from someone else — owner via one collectionGroup
 *    listener, member via one listener per assigned task
 *  - a task newly assigned to me
 *  - an @-mention of me in a message
 *  - (owner/manager) a task moving into "In Review", scoped to the clients
 *    they manage
 * In-app only — nothing fires when the app isn't open in a tab.
 */
export function useMessagePing() {
  const { user, member } = useAuth()
  const isOwner = isOwnerRole(member?.role)
  const isAdmin = isAdminRole(member?.role)
  const myUid = user?.uid

  // My assigned tasks — drives the member comment listeners AND the
  // "assigned to a task" ping (everyone, owner included).
  const { tasks: myTasks, loading: myTasksLoading } = useMyTasks(myUid)

  // Ignore everything that already existed when this session started.
  const startedAt = useRef(Date.now())
  const seen = useRef(new Set<string>())

  function handle(c: LatestComment | null, taskUrl?: string) {
    if (!c || !myUid) return
    if (c.authorUid === myUid) return
    if (seen.current.has(c.id)) return
    const ts = c.createdAt?.toMillis?.() ?? 0
    if (ts && ts < startedAt.current) {
      seen.current.add(c.id)
      return
    }
    seen.current.add(c.id)
    playPing()
    const mentioned = !!c.mentions?.includes(myUid)
    const body = c.text?.trim() || (c.imageUrl ? '📷 صورة' : c.audioUrl ? '🎤 رسالة صوتية' : '📎 ملف')
    const title = mentioned
      ? `📣 ${c.authorName || 'حد'} عملك منشن`
      : `💬 ${c.authorName || 'رسالة جديدة'}`
    showMessageNotification(title, body, mentioned, taskUrl)
  }

  /** Extract task app-URL from a Firestore comment doc path. */
  function commentPathToTaskUrl(docPath: string): string | undefined {
    // "clients/cId/projects/pId/tasks/tId/comments/commentId"
    const parts = docPath.split('/')
    if (parts.length === 8 && parts[0] === 'clients' && parts[4] === 'tasks') {
      return `/clients/${parts[1]}/projects/${parts[3]}/tasks/${parts[5]}#chat`
    }
    return undefined
  }

  // ── Owner: every task's chat ──────────────────────────────────
  useEffect(() => {
    if (!isOwner || !myUid) return
    const q = query(collectionGroup(db, 'comments'), orderBy('createdAt', 'desc'), limit(1))
    return onSnapshot(
      q,
      (snap) => {
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed') return
          const taskUrl = commentPathToTaskUrl(ch.doc.ref.path)
          handle({ id: ch.doc.id, ...(ch.doc.data() as Omit<LatestComment, 'id'>) }, taskUrl)
        })
      },
      (err) => console.error('useMessagePing (owner):', err.message)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, myUid])

  // ── Anyone: pinged when a task is newly assigned to me ────────
  const knownTaskIds = useRef<Set<string>>(new Set())
  const baselineSet = useRef(false)
  useEffect(() => {
    if (!myUid || myTasksLoading) return
    const ids = new Set(myTasks.map((t) => t.id))
    if (!baselineSet.current) {
      baselineSet.current = true
      knownTaskIds.current = ids
      return
    }
    for (const t of myTasks) {
      if (knownTaskIds.current.has(t.id)) continue
      playPing()
      showMessageNotification('📋 اتعملك assign على تاسك', t.title || 'تاسك جديدة', true)
    }
    knownTaskIds.current = ids
  }, [myUid, myTasks, myTasksLoading])

  // ── Owner/manager: pinged when a task moves into "In Review" ──
  // Scoped the same way as the Admin "All Assignments" page: unscoped for
  // the owner, `clientId in managedClientIds` for a manager.
  const managedClientIds = member?.managedClientIds ?? []
  const watchReview = isOwner || managedClientIds.length > 0
  const { tasks: allTasks, loading: allTasksLoading } = useAllTasks(
    isAdmin && watchReview,
    isOwner ? null : managedClientIds
  )
  const lastStatus = useRef(new Map<string, TaskStatus>())
  const reviewBaselineSet = useRef(false)
  useEffect(() => {
    if (!isAdmin || !watchReview || allTasksLoading) return
    if (!reviewBaselineSet.current) {
      reviewBaselineSet.current = true
      lastStatus.current = new Map(allTasks.map((t) => [t.id, t.status]))
      return
    }
    for (const t of allTasks) {
      const was = lastStatus.current.get(t.id)
      if (t.status === 'in_review' && was !== 'in_review' && !t.assigneeUids?.includes(myUid ?? '')) {
        playPing()
        showMessageNotification('👀 تاسك جاهزة للمراجعة', t.title || 'تاسك', true)
      }
    }
    lastStatus.current = new Map(allTasks.map((t) => [t.id, t.status]))
  }, [isAdmin, watchReview, allTasks, allTasksLoading, myUid])

  // ── Member: one listener per assigned task ────────────────────
  const subs = useRef(new Map<string, Unsubscribe>())
  useEffect(() => {
    if (isOwner || !myUid) return
    const wanted = new Set(
      myTasks.map((t) => `clients/${t.clientId}/projects/${t.projectId}/tasks/${t.id}`)
    )

    // Drop listeners for tasks no longer assigned to me
    for (const [path, unsub] of subs.current) {
      if (!wanted.has(path)) {
        unsub()
        subs.current.delete(path)
      }
    }

    // Add listeners for new tasks
    for (const t of myTasks) {
      const path = `clients/${t.clientId}/projects/${t.projectId}/tasks/${t.id}`
      if (subs.current.has(path)) continue
      const q = query(
        collection(db, 'clients', t.clientId, 'projects', t.projectId, 'tasks', t.id, 'comments'),
        orderBy('createdAt', 'desc'),
        limit(1)
      )
      const taskUrl = `/clients/${t.clientId}/projects/${t.projectId}/tasks/${t.id}#chat`
      subs.current.set(
        path,
        onSnapshot(
          q,
          (snap) => {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'removed') return
              handle({ id: ch.doc.id, ...(ch.doc.data() as Omit<LatestComment, 'id'>) }, taskUrl)
            })
          },
          (err) => console.error('useMessagePing (member):', err.message)
        )
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, myUid, myTasks])

  // Tear everything down on unmount
  useEffect(() => {
    const map = subs.current
    return () => {
      for (const unsub of map.values()) unsub()
      map.clear()
    }
  }, [])
}
