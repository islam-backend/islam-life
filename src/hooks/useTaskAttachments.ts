import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'

export interface TaskAttachment {
  id: string
  fileName: string
  fileType: string
  /** base64 data URL — set for non-text files */
  fileDataUrl?: string
  /** Raw text content — set for text/MD/JSON etc. */
  textContent?: string
  fileSize: number
  createdAt?: unknown
  createdBy?: string
  createdByName?: string
}

export function useTaskAttachments(clientId: string, projectId: string, taskId: string) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId || !projectId || !taskId) return
    const q = query(
      collection(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'attachments'),
      orderBy('createdAt', 'asc')
    )
    return onSnapshot(
      q,
      (snap) => {
        setAttachments(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TaskAttachment))
        setLoading(false)
      },
      () => setLoading(false)
    )
  }, [clientId, projectId, taskId])

  return { attachments, loading }
}
