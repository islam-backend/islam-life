import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { TaskComment } from '../types/comment'

/** Live chat thread for one task — oldest message first. */
export function useTaskComments(clientId: string, projectId: string, taskId: string) {
  const [comments, setComments] = useState<TaskComment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId || !projectId || !taskId) return
    setLoading(true)
    const ref = collection(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'comments')
    return onSnapshot(
      query(ref, orderBy('createdAt', 'asc')),
      (snap) => {
        setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TaskComment))
        setLoading(false)
      },
      (err) => {
        console.error('useTaskComments:', err.message)
        setLoading(false)
      }
    )
  }, [clientId, projectId, taskId])

  return { comments, loading }
}
