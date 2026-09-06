import { collectionGroup, onSnapshot, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Task } from '../types/task'

/** Every task across every client/project — owner-only (see firestore.rules).
 * Pass `enabled=false` for a non-owner so the query never runs (it would be
 * rejected). */
export function useAllTasks(enabled = true) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setTasks([])
      setLoading(false)
      return
    }
    return onSnapshot(
      query(collectionGroup(db, 'tasks')),
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Task))
        setLoading(false)
      },
      (err) => {
        console.error('useAllTasks:', err.message)
        setLoading(false)
      }
    )
  }, [enabled])

  return { tasks, loading }
}
