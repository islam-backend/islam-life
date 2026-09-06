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

/** Shows a notification only when the tab isn't focused — no point stealing
 * attention for a chat the user is already looking at. */
export function showMessageNotification(title: string, body: string) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    if (!document.hidden) return
    const n = new Notification(title, { body, tag: 'task-chat', icon: '/icon-192.png' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* ignore */
  }
}
