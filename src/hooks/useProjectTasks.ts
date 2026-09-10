import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Member } from '../types/member'
import type { Task } from '../types/task'

/**
 * Live tasks for one project. A plain member's query MUST filter by their
 * own uid — Firestore rejects an unfiltered `list` query outright when the
 * matching security rule depends on document data (it can't prove every
 * possible result would pass), it doesn't silently filter results for
 * you. The owner (and a manager of this client) have no such restriction —
 * pass `canManage=true` for them.
 */
export function useProjectTasks(
  clientId: string | null,
  projectId: string | null,
  member: Member | null,
  canManage: boolean
) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId || !projectId || !member) {
      setTasks([])
      setLoading(false)
      return
    }

    const tasksRef = collection(db, 'clients', clientId, 'projects', projectId, 'tasks')
    const q = canManage
      ? query(tasksRef, orderBy('orderIndex'))
      : query(tasksRef, where('assigneeUids', 'array-contains', member.uid), orderBy('orderIndex'))

    setLoading(true)
    return onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Task))
        setLoading(false)
      },
      (err) => {
        console.error('useProjectTasks:', err.message)
        setLoading(false)
      }
    )
  }, [clientId, projectId, member, canManage])

  return { tasks, loading }
}
