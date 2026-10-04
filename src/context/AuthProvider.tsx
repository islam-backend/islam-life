import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { createContext, type ReactNode, useEffect, useState } from 'react'

import { logActivity, setActivityActor } from '../lib/activityLog'
import { auth, db, googleProvider } from '../lib/firebase/app'
import type { Member } from '../types/member'
import { isOwnerRole } from '../utils/role'

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

const setupRef = () => doc(db, 'setup', 'workspace')

/**
 * First-run: if this workspace has no owner yet (no setup/workspace doc),
 * make this account the owner — the member doc and the marker are written
 * in one batch, which is exactly what the owner-claim rule requires. False
 * when the workspace is already claimed (or anything is denied).
 */
async function claimWorkspace(user: User): Promise<boolean> {
  try {
    if ((await getDoc(setupRef())).exists()) return false
    const batch = writeBatch(db)
    batch.set(doc(db, 'members', user.uid), {
      email: user.email,
      displayName: user.displayName || user.email?.split('@')[0] || 'Owner',
      role: 'owner',
      avatarUrl: user.photoURL || null,
      totpEnrolled: false,
      assignedProjects: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    batch.set(setupRef(), { ownerUid: user.uid, createdAt: serverTimestamp() })
    await batch.commit()
    return true
  } catch {
    return false
  }
}

/** `invitedBy` / `invitedByRole` from my own invite (I may read just that
 * one — see firestore.rules). Omitted when the invite doesn't carry them,
 * never written as null: the rules compare field-for-field with the invite. */
async function inviterOf(user: User): Promise<{ invitedBy?: string; invitedByRole?: string }> {
  try {
    const inv = await getDoc(doc(db, 'invites', (user.email || '').toLowerCase()))
    const data = inv.data() ?? {}
    return {
      ...(typeof data.invitedBy === 'string' ? { invitedBy: data.invitedBy } : {}),
      ...(typeof data.invitedByRole === 'string' ? { invitedByRole: data.invitedByRole } : {}),
    }
  } catch {
    return {}
  }
}

async function ensureSetupMarker(ownerUid: string) {
  try {
    if (!(await getDoc(setupRef())).exists()) {
      await setDoc(setupRef(), { ownerUid, createdAt: serverTimestamp() })
    }
  } catch {
    /* rules not deployed yet — try again next sign-in */
  }
}

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
        setActivityActor(null)
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
    let justJoined = false
    let checkedSetup = false

    return onSnapshot(doc(db, 'members', user.uid), async (snap) => {
      if (snap.exists()) {
        const data = { uid: snap.id, ...snap.data() } as Member
        setActivityActor(data)
        setMember(data)
        if (justJoined) {
          justJoined = false
          void logActivity([{ type: 'member.joined', memberUid: data.uid, targetName: data.displayName || data.email, to: data.role }])
        }
        setMemberResolved(true)

        // A workspace whose owner predates the first-run claim has no
        // setup/workspace marker yet — write it, closing the claim path.
        if (isOwnerRole(data.role) && !checkedSetup) {
          checkedSetup = true
          void ensureSetupMarker(data.uid)
        }

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
            // Who invited me — the rules require these to match the invite.
            ...(await inviterOf(user)),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
          justJoined = true
          // onSnapshot will re-fire on its own once this write lands.
        } catch {
          // Not invited — but on a brand-new workspace the first account
          // to sign in becomes its owner.
          if (await claimWorkspace(user)) {
            justJoined = true
          } else {
            setNotInvited(true)
            setMemberResolved(true)
          }
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
