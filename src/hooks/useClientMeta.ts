import { collection, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'

export interface ClientMeta {
  name: string
  avatarUrl?: string
}

/** Lightweight `clientId → { name, avatarUrl }` map — just the top-level
 * client docs, no projects. Any signed-in member can read these. */
export function useClientMeta() {
  const [meta, setMeta] = useState<Map<string, ClientMeta>>(new Map())

  useEffect(() => {
    return onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        const m = new Map<string, ClientMeta>()
        for (const d of snap.docs) {
          const data = d.data()
          m.set(d.id, { name: data.name ?? 'Client', avatarUrl: data.avatarUrl ?? undefined })
        }
        setMeta(m)
      },
      (err) => console.error('useClientMeta:', err.message)
    )
  }, [])

  return meta
}
