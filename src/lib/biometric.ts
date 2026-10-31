import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { BiometricAuth, BiometryError, type CheckBiometryResult } from '@aparajita/capacitor-biometric-auth'

const ENABLED_KEY = 'biometric-lock-enabled'

export const isNativePlatform = (): boolean => Capacitor.isNativePlatform()

/** Null on web, or if the native check itself throws. */
export async function getBiometryStatus(): Promise<CheckBiometryResult | null> {
  if (!isNativePlatform()) return null
  try {
    return await BiometricAuth.checkBiometry()
  } catch {
    return null
  }
}

export async function isBiometricLockEnabled(): Promise<boolean> {
  if (!isNativePlatform()) return false
  const { value } = await Preferences.get({ key: ENABLED_KEY })
  return value === 'true'
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  await Preferences.set({ key: ENABLED_KEY, value: enabled ? 'true' : 'false' })
}

/** Resolves true on success, false if the user cancelled/failed — never throws for that. */
export async function verifyBiometric(reason: string): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({ reason, allowDeviceCredential: true })
    return true
  } catch (err) {
    if (err instanceof BiometryError) return false
    throw err
  }
}

/** Fires on every app resume, once registered — checkBiometry() must run first. */
export function onBiometricResume(listener: (status: CheckBiometryResult) => void): Promise<PluginListenerHandle> {
  return BiometricAuth.addResumeListener(listener)
}
