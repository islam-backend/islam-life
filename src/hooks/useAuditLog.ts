import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Member } from '../types/member'
import { type ActivityEntry, compareNewest } from '../utils/activity'
import { isManagerRole, isOwnerRole } from '../utils/role'

/**
 * Live audit log, newest first.
 * - Owner: one query over everything.
 * - Manager: only "their people", as separate queries merged here — each
 *   one matches a single branch of the inline auditLog rule, so Firestore
 *   can prove it safe:
 *     · their own actions                        (actorUid == me)
 *     · people they invited                      (actorInvitedBy == me)
 *     · people the owner invited, if the owner
 *       turned that on for them                  (actorInviterRole == 'owner')
 */
export function useAuditLog(member: Member | null, pageSize = 100) {
  const [max, setMax] = useState(pageSize)
  const [byKey, setByKey] = useState<Record<string, ActivityEntry[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const owner = isOwnerRole(member?.role)
  const manager = isManagerRole(member?.role)
  const seesOwnerInvitees = manager && member?.auditSeesOwnerInvitees === true
  const uid = member?.uid

  useEffect(() => {
    if (!uid) return
    const coll = collection(db, 'auditLog')
    const newest = [orderBy('createdAt', 'desc'), limit(max)] as const
    const queries = owner
      ? [{ key: '*', q: query(coll, ...newest) }]
      : manager
        ? [
            { key: 'self', q: query(coll, where('actorUid', '==', uid), ...newest) },
            { key: 'mine', q: query(coll, where('actorInvitedBy', '==', uid), ...newest) },
            ...(seesOwnerInvitees
              ? [{ key: 'owner', q: query(coll, where('actorInviterRole', '==', 'owner'), ...newest) }]
              : []),
          ]
        : []

    // Drop results from a query that no longer applies (e.g. owner revoked access).
    setByKey((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => queries.some((x) => x.key === k))))

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
  }, [uid, owner, manager, seesOwnerInvitees, max])

  const entries = useMemo(
    () =>
      // A manager's queries can overlap (e.g. an owner-invited manager's own
      // actions also match actorInviterRole == 'owner') — dedupe by id.
      [...new Map(Object.values(byKey).flat().map((e) => [e.id, e])).values()]
        .sort(compareNewest)
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
