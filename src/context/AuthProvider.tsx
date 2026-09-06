import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { createContext, type ReactNode, useEffect, useState } from 'react'

import { auth, db, googleProvider } from '../lib/firebase/app'
import type { Member } from '../types/member'

interface AuthContextValue {
  user: User | null
  member: Member | null
  /** True while we don't yet know the auth/member state. */
  loading: boolean
  /**
   * True once we've tried to self-provision members/{uid} (see the
   * `create` rule in firestore.rules) and Firestore rejected it — i.e.
   * this Google account's email isn't in invites/. A signed-in Google
   * account always exists in Firebase Auth (nothing can stop that
   * without a paid Identity Platform project); the invite gate is
   * enforced entirely by Firestore rules instead, so a non-invited
   * account can authenticate but can never read or write any app data.
   */
  notInvited: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [authResolved, setAuthResolved] = useState(false)
  const [memberResolved, setMemberResolved] = useState(false)
  const [notInvited, setNotInvited] = useState(false)

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthResolved(true)
      if (!nextUser) {
        setMember(null)
        setMemberResolved(true)
        setNotInvited(false)
      }
    })
  }, [])

  useEffect(() => {
    if (!user) return
    setMemberResolved(false)
    setNotInvited(false)
    let triedProvisioning = false

    return onSnapshot(doc(db, 'members', user.uid), async (snap) => {
      if (snap.exists()) {
        const data = { uid: snap.id, ...snap.data() } as Member
        setMember(data)
        setMemberResolved(true)

        // Self-heal: a doc created by hand in the console (the one-time
        // owner bootstrap) won't have avatarUrl set. Backfill it quietly
        // from the Google account if one wasn't set yet.
        if (!data.avatarUrl && user.photoURL) {
          updateDoc(doc(db, 'members', user.uid), {
            avatarUrl: user.photoURL,
            updatedAt: serverTimestamp(),
          }).catch(() => {})
        }
        return
      }

      setMember(null)

      // No member doc yet — try to self-provision it (see the `create`
      // rule in firestore.rules). Succeeds only if this email is in
      // invites/, and always as role 'member'. Only try once per sign-in
      // so a genuinely non-invited account doesn't retry forever.
      if (!triedProvisioning) {
        triedProvisioning = true
        try {
          await setDoc(doc(db, 'members', user.uid), {
            email: user.email,
            displayName: user.displayName || user.email?.split('@')[0] || 'Member',
            role: 'member',
            avatarUrl: user.photoURL || null,
            totpEnrolled: false,
            assignedProjects: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
          // onSnapshot will re-fire on its own once this write lands.
        } catch {
          setNotInvited(true)
          setMemberResolved(true)
        }
      } else {
        setMemberResolved(true)
      }
    }, () => {
      // A permission-denied here (e.g. rules mid-edit, or a genuinely
      // blocked account) must never leave the app stuck on "Loading…" —
      // treat it the same as "no access".
      setMember(null)
      setNotInvited(true)
      setMemberResolved(true)
    })
  }, [user])

  const value: AuthContextValue = {
    user,
    member,
    loading: !authResolved || !memberResolved,
    notInvited,
    signInWithGoogle: async () => {
      await signInWithPopup(auth, googleProvider)
    },
    signOut: () => firebaseSignOut(auth),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
