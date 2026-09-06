import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Task } from '../types/task'

export function useTaskDetail(clientId: string, projectId: string, taskId: string) {
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    return onSnapshot(
      doc(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId),
      (snap) => {
        setTask(snap.exists() ? ({ id: snap.id, ...snap.data() } as Task) : null)
        setLoading(false)
      },
      (err) => {
        console.error('useTaskDetail:', err.message)
        setLoading(false)
      }
    )
  }, [clientId, projectId, taskId])

  return { task, loading }
}
