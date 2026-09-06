import { collection, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Member } from '../types/member'

/** Live roster of every team member (owner + members). Small team, so no pagination. */
export function useMembers() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onSnapshot(
      collection(db, 'members'),
      (snap) => {
        setMembers(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as Member))
        setLoading(false)
      },
      (err) => {
        console.error('useMembers:', err.message)
        setLoading(false)
      }
    )
  }, [])

  return { members, loading }
}
