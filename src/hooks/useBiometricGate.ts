import { useEffect, useState } from 'react'

import { isBiometricLockEnabled, isNativePlatform, onBiometricResume } from '../lib/biometric'

/**
 * While there's a signed-in session on native, this starts locked (so there's
 * no flash of app content before we've checked Preferences) and re-locks
 * every time the app resumes from the background — the whole point of the
 * fingerprint lock is to replace re-typing Google sign-in, not just gate the
 * very first launch.
 */
export function useBiometricGate(hasSession: boolean): { locked: boolean; unlock: () => void } {
  const native = isNativePlatform()
  const [locked, setLocked] = useState(native)

  useEffect(() => {
    if (!hasSession || !native) {
      setLocked(false)
      return
    }
    setLocked(true)
    let handle: { remove: () => void } | undefined
    let cancelled = false

    void (async () => {
      const enabled = await isBiometricLockEnabled()
      if (cancelled) return
      setLocked(enabled)
      if (enabled) {
        handle = await onBiometricResume(() => setLocked(true))
      }
    })()

    return () => {
      cancelled = true
      handle?.remove()
    }
  }, [hasSession, native])

  return { locked: hasSession && native && locked, unlock: () => setLocked(false) }
}
