import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import { type ActivityEntry, compareNewest } from '../utils/activity'
import { useAuth } from './useAuth'

export interface AppNotification extends ActivityEntry {
  read: boolean
}

/** My notifications, newest first. `max` grows via loadMore() on the full page. */
export function useNotifications(initialMax = 50) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [max, setMax] = useState(initialMax)

  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'members', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(max),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifications(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, 'id'>) }))
            .sort(compareNewest),
        )
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [user?.uid, max])

  const unreadCount = notifications.filter((n) => !n.read).length
  const hasMore = notifications.length >= max

  async function markRead(notifId: string) {
    if (!user?.uid) return
    await updateDoc(doc(db, 'members', user.uid, 'notifications', notifId), { read: true })
  }

  async function markAllRead() {
    if (!user?.uid) return
    const unread = notifications.filter((n) => !n.read)
    if (unread.length === 0) return
    const batch = writeBatch(db)
    for (const n of unread) {
      batch.update(doc(db, 'members', user.uid, 'notifications', n.id), { read: true })
    }
    await batch.commit()
  }

  return {
    notifications,
    loading,
    unreadCount,
    hasMore,
    loadMore: () => setMax((m) => m + initialMax),
    markRead,
    markAllRead,
  }
}
