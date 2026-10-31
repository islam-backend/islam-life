import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useEffect } from 'react'

import { db } from '../lib/firebase/app'
import { isNativePlatform } from '../lib/biometric'
import { ensureNotificationPermission } from '../lib/notify'
import { getDeviceFcmToken } from '../lib/push'

/** Native only: once signed in, make sure this device's FCM token is saved
 * on the member doc (so the push-relay Worker — see worker/push-relay —
 * knows where to send). Skips the write entirely when the token hasn't
 * changed, and does nothing at all on web or if notifications are denied. */
export function useRegisterPushToken(uid: string | undefined, currentToken: string | null | undefined) {
  useEffect(() => {
    if (!uid || !isNativePlatform()) return
    let cancelled = false
    void (async () => {
      const granted = await ensureNotificationPermission()
      if (!granted || cancelled) return
      const token = await getDeviceFcmToken()
      if (!token || cancelled || token === currentToken) return
      await updateDoc(doc(db, 'members', uid), {
        fcmToken: token,
        fcmTokenUpdatedAt: serverTimestamp(),
      }).catch(() => {
        /* best-effort */
      })
    })()
    return () => {
      cancelled = true
    }
    // Re-run only when the signed-in user or the known token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, currentToken])
}
