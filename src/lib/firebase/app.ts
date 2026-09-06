import { type FirebaseApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

import { firebaseConfig } from './config'

export const app: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig)

export const auth = getAuth(app)

// Brave (and some ad-block extensions) block Firestore's streaming
// requests outright. Auto-detect only falls back when it can positively
// detect the failure, which an extension-level block doesn't always
// trigger — force long-polling unconditionally instead.
export const db = initializeFirestore(app, { experimentalForceLongPolling: true })
export const storage = getStorage(app)

export const googleProvider = new GoogleAuthProvider()
// Always show the account chooser — this is a shared machine scenario
// (owner + member could sign in on the same browser).
googleProvider.setCustomParameters({ prompt: 'select_account' })
