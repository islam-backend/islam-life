import { collection, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { AssignedProject, MemberRole } from '../types/member'

export interface Invite {
  email: string
  role: MemberRole
  assignedProjects: AssignedProject[]
  invitedAt?: unknown
  invitedBy?: string
}

/** Owner-only — see firestore.rules. The pending-invite list for Admin → Team. */
export function useInvites() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onSnapshot(
      collection(db, 'invites'),
      (snap) => {
        setInvites(snap.docs.map((d) => ({ email: d.id, ...d.data() }) as Invite))
        setLoading(false)
      },
      (err) => {
        console.error('useInvites:', err.message)
        setLoading(false)
      }
    )
  }, [])

  return { invites, loading }
}
