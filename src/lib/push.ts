import { FirebaseMessaging } from '@capacitor-firebase/messaging'

import { getFirebaseConfig } from './firebase/config'
import { isNativePlatform } from './biometric'

/** Native only: current FCM device token, or null if permission isn't
 * granted (caller should request it first — see notify.ts) or the native
 * messaging plugin has no token yet. */
export async function getDeviceFcmToken(): Promise<string | null> {
  if (!isNativePlatform()) return null
  try {
    const { token } = await FirebaseMessaging.getToken()
    return token || null
  } catch {
    return null
  }
}

/**
 * Tell the push-relay Worker to push to these members right now — for
 * someone who isn't looking at the app (closed, or backgrounded long enough
 * for Android to have killed the process). A no-op when the deployment
 * hasn't configured a relay (see FirebaseWebConfig.pushRelayUrl) — other
 * white-label workspaces just don't get this feature, nothing breaks.
 * Fire-and-forget: never blocks or throws into the caller.
 */
export function notifyPush(uids: string[], title: string, body: string, url?: string) {
  if (uids.length === 0) return
  const { pushRelayUrl, pushRelaySecret } = getFirebaseConfig()
  if (!pushRelayUrl) return
  fetch(pushRelayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(pushRelaySecret ? { 'X-App-Secret': pushRelaySecret } : {}),
    },
    body: JSON.stringify({ uids, title, body, url }),
  }).catch(() => {
    /* best-effort — the in-app notification already covers an open app */
  })
}
