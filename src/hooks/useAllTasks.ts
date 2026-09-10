import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Task } from '../types/task'

/**
 * Every task across every client/project — owner-only when unscoped (see
 * firestore.rules). Pass `enabled=false` for anyone who can't run it.
 *
 * A manager passes their `managedClientIds` as `clientIds`: the query is
 * then filtered to `clientId in [...]` (Firestore `in` caps at 30, plenty
 * for a manager's client list) and the rules let a manager read those.
 */
export function useAllTasks(enabled = true, clientIds?: string[] | null) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(enabled)

  const scopeKey = (clientIds ?? []).join(',')

  useEffect(() => {
    if (!enabled) {
      setTasks([])
      setLoading(false)
      return
    }
    const scope = scopeKey ? scopeKey.split(',') : null
    const base = collectionGroup(db, 'tasks')
    const q = scope ? query(base, where('clientId', 'in', scope.slice(0, 30))) : query(base)

    setLoading(true)
    return onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Task))
        setLoading(false)
      },
      (err) => {
        console.error('useAllTasks:', err.message)
        setLoading(false)
      }
    )
  }, [enabled, scopeKey])

  return { tasks, loading }
}
