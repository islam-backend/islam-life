import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Task } from '../types/task'
import { isArchived } from '../utils/taskStatus'

/** Every task the given member is an assignee on, across all projects.
 * Members can't run an unfiltered collectionGroup query (see firestore.rules)
 * — this one filters by `assigneeUids array-contains uid`, which they can.
 * Archived tasks are left out unless `archived=true` (then only those). */
export function useMyTasks(uid: string | undefined, archived = false) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) {
      setTasks([])
      setLoading(false)
      return
    }
    setLoading(true)
    return onSnapshot(
      query(collectionGroup(db, 'tasks'), where('assigneeUids', 'array-contains', uid)),
      (snap) => {
        setTasks(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Task).filter((t) => isArchived(t) === archived)
        )
        setLoading(false)
      },
      (err) => {
        console.error('useMyTasks:', err.message)
        setLoading(false)
      }
    )
  }, [uid, archived])

  return { tasks, loading }
}
