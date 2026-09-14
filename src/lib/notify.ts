// In-app "new message" feedback — a short sound plus a browser notification
// when the tab is in the background. No FCM / service worker: this only fires
// while the app is open in a tab (that was the product decision).

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

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const res = await Notification.requestPermission()
  return res === 'granted'
}

/** Shows a browser notification. By default only when the tab isn't
 * focused (no point stealing attention for a chat you're looking at);
 * pass `alwaysShow` for rarer, important events like a task assignment.
 * Pass `url` to navigate to a specific page when the notification is clicked. */
export function showMessageNotification(title: string, body: string, alwaysShow = false, url?: string) {
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
