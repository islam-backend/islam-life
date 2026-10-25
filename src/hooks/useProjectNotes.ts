import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { ProjectNote } from '../types/note'

export function useProjectNotes(clientId: string, projectId: string) {
  const [notes, setNotes] = useState<ProjectNote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId || !projectId) return
    setLoading(true)
    const q = query(collection(db, 'clients', clientId, 'projects', projectId, 'notes'), orderBy('createdAt', 'desc'))
    return onSnapshot(
      q,
      (snap) => {
        setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectNote))
        setLoading(false)
      },
      (err) => {
        console.error('useProjectNotes:', err.message)
        setLoading(false)
      }
    )
  }, [clientId, projectId])

  return { notes, loading }
}
