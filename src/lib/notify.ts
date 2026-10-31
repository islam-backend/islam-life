// In-app "new message" feedback — a short sound plus a notification when the
// app is in the background. No FCM / service worker: this only fires while
// the app process is alive (that was the product decision) — on the web
// that means an open tab; on native it also covers the app being backgrounded
// (not force-closed), since LocalNotifications posts a real system
// notification instead of relying on the WebView's (unreliable) Notification
// API.

import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const isNativePlatform = () => Capacitor.isNativePlatform()

let audioCtx: AudioContext | null = null

/** Must be called from a user gesture at least once (browsers block audio
 * otherwise). Safe to call repeatedly. */
export function primeAudio() {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new Ctor()
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    /* no audio available — ignore */
  }
}

let unlockAttached = false

/** Primes audio on the very first click/keypress/tap anywhere in the app.
 * Without this, a returning user (Notification permission already granted
 * from a previous visit, so the "🔔 Enable notifications" button never
 * renders again) never triggers `primeAudio()` from a real user gesture —
 * `playPing()` then creates the AudioContext for the first time on its own,
 * outside any gesture, and the browser leaves it permanently suspended:
 * the notification still shows, but the ding never plays. Call once from
 * the app shell. */
export function setupAudioAutoUnlock() {
  if (unlockAttached || typeof document === 'undefined') return
  unlockAttached = true
  const unlock = () => primeAudio()
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) {
    document.addEventListener(type, unlock, { passive: true })
  }
}

/** A soft two-note "ding". */
export function playPing() {
  try {
    primeAudio()
    if (!audioCtx) return
    const now = audioCtx.currentTime
    const gain = audioCtx.createGain()
    gain.connect(audioCtx.destination)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4)

    for (const [freq, at] of [[880, 0], [1174, 0.09]] as const) {
      const osc = audioCtx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(now + at)
      osc.stop(now + at + 0.35)
    }
  } catch {
    /* ignore */
  }
}

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

/** Read-only status check (never prompts) — native and web. */
export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  if (isNativePlatform()) {
    const status = await LocalNotifications.checkPermissions()
    if (status.display === 'granted') return 'granted'
    if (status.display === 'denied') return 'denied'
    return 'default' // 'prompt' | 'prompt-with-rationale'
  }
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (isNativePlatform()) {
    const status = await LocalNotifications.checkPermissions()
    if (status.display === 'granted') return true
    if (status.display === 'denied') return false
    const res = await LocalNotifications.requestPermissions()
    return res.display === 'granted'
  }
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const res = await Notification.requestPermission()
  return res === 'granted'
}

let nextLocalNotificationId = 1

/** Shows a notification. By default only when the app isn't focused
 * (no point stealing attention for a chat you're looking at); pass
 * `alwaysShow` for rarer, important events like a task assignment.
 * Pass `url` to navigate to a specific page when the notification is tapped.
 * Native: a real Android system notification via LocalNotifications — works
 * while backgrounded, not just foregrounded. Web: the browser Notification API. */
export function showMessageNotification(title: string, body: string, alwaysShow = false, url?: string) {
  if (isNativePlatform()) {
    if (!alwaysShow && document.visibilityState === 'visible') return
    LocalNotifications.schedule({
      notifications: [
        {
          id: nextLocalNotificationId++,
          title,
          body,
          extra: url ? { url } : undefined,
        },
      ],
    }).catch(() => {
      /* permission not granted yet — ignore */
    })
    return
  }
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (!alwaysShow && !document.hidden) return
    const n = new Notification(title, { body, tag: url ?? 'task-chat', icon: '/icon-192.png' })
    n.onclick = () => {
      window.focus()
      if (url) window.location.href = url
      n.close()
    }
  } catch {
    /* ignore */
  }
}

/** Call once on native — routes a tapped system notification to its page. */
export function setupNativeNotificationTapHandler() {
  if (!isNativePlatform()) return
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const url = (action.notification.extra as { url?: string } | undefined)?.url
    if (url) window.location.href = url
  })
}
