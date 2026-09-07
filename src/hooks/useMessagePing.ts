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
import { isOwnerRole } from '../utils/role'
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
 * In-app only — nothing fires when the app isn't open in a tab.
 */
export function useMessagePing() {
  const { user, member } = useAuth()
  const isOwner = isOwnerRole(member?.role)
  const myUid = user?.uid

  // My assigned tasks — drives the member comment listeners AND the
  // "assigned to a task" ping (everyone, owner included).
  const { tasks: myTasks, loading: myTasksLoading } = useMyTasks(myUid)

  // Ignore everything that already existed when this session started.
  const startedAt = useRef(Date.now())
  const seen = useRef(new Set<string>())

  function handle(c: LatestComment | null) {
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
    const body = c.text?.trim() || (c.imageUrl ? '📷 صورة' : 'رسالة جديدة')
    const title = mentioned
      ? `📣 ${c.authorName || 'حد'} عملك منشن`
      : `💬 ${c.authorName || 'رسالة جديدة'}`
    showMessageNotification(title, body, mentioned)
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
          handle({ id: ch.doc.id, ...(ch.doc.data() as Omit<LatestComment, 'id'>) })
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
      subs.current.set(
        path,
        onSnapshot(
          q,
          (snap) => {
            snap.docChanges().forEach((ch) => {
              if (ch.type === 'removed') return
              handle({ id: ch.doc.id, ...(ch.doc.data() as Omit<LatestComment, 'id'>) })
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
