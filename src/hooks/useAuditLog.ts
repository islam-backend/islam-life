import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Member } from '../types/member'
import { type ActivityEntry, millisOf } from '../utils/activity'
import { isManagerRole, isOwnerRole } from '../utils/role'

/**
 * Live audit log, newest first.
 * - Owner: one query over everything.
 * - Manager: one `clientId ==` query per managed client, merged — each is
 *   provable against the inline rule in firestore.rules (an `in` query over
 *   a get()-based list is not something to bet on).
 */
export function useAuditLog(member: Member | null, pageSize = 100) {
  const [max, setMax] = useState(pageSize)
  const [byKey, setByKey] = useState<Record<string, ActivityEntry[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const owner = isOwnerRole(member?.role)
  const managed = isManagerRole(member?.role) ? (member?.managedClientIds ?? []) : []
  const managedKey = managed.join(',')

  useEffect(() => {
    if (!member?.uid) return
    const coll = collection(db, 'auditLog')
    const queries = owner
      ? [{ key: '*', q: query(coll, orderBy('createdAt', 'desc'), limit(max)) }]
      : managedKey
          .split(',')
          .filter(Boolean)
          .map((clientId) => ({
            key: clientId,
            q: query(coll, where('clientId', '==', clientId), orderBy('createdAt', 'desc'), limit(max)),
          }))

    if (queries.length === 0) {
      setByKey({})
      setLoading(false)
      return
    }

    setLoading(true)
    const unsubs = queries.map(({ key, q }) =>
      onSnapshot(
        q,
        (snap) => {
          setByKey((prev) => ({
            ...prev,
            [key]: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActivityEntry),
          }))
          setLoading(false)
        },
        (err) => {
          console.error('useAuditLog:', err.message)
          setError(err.message)
          setLoading(false)
        }
      )
    )
    return () => unsubs.forEach((u) => u())
  }, [member?.uid, owner, managedKey, max])

  const entries = useMemo(
    () =>
      Object.values(byKey)
        .flat()
        .sort((a, b) => millisOf(b) - millisOf(a))
        .slice(0, max),
    [byKey, max]
  )

  return {
    entries,
    loading,
    error,
    hasMore: Object.values(byKey).some((list) => list.length >= max),
    loadMore: () => setMax((m) => m + pageSize),
  }
}
