import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import { useAuth } from './useAuth'

export interface AppNotification {
  id: string
  taskId: string
  clientId: string
  projectId: string
  taskTitle: string
  type: 'assigned'
  read: boolean
  createdAt: { toMillis?: () => number } | null
}

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  useEffect(() => {
    if (!user?.uid) return
    const q = query(
      collection(db, 'members', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, 'id'>) })),
      )
    })
    return unsub
  }, [user?.uid])

  const unreadCount = notifications.filter((n) => !n.read).length

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

  return { notifications, unreadCount, markRead, markAllRead }
}
