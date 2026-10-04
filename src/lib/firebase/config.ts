// The Firebase project is chosen at RUNTIME, not baked into the bundle, so
// one build can be handed to any customer: they drop their own Firebase web
// config into `public/firebase-config.json` (or upload it on the Setup
// screen) and the app connects to their project.
//
// The web config is public by design — the apiKey is not a secret. Real
// security lives in firestore.rules / storage.rules. NEVER put a service
// account key here (parseFirebaseConfig refuses one).
//
// This module must not import firebase/* — main.tsx loads it before the
// Firebase SDK is initialised, and the Setup screen runs without Firebase.

export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  storageBucket?: string
  messagingSenderId?: string
  measurementId?: string
  /** Not part of Firebase's config — the workspace's display name. */
  appName?: string
}

const LOCAL_KEY = 'firebase-web-config'
const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'] as const
const KNOWN = [...REQUIRED, 'storageBucket', 'messagingSenderId', 'measurementId', 'appName'] as const

let current: FirebaseWebConfig | null = null

/**
 * Accepts what Firebase Console gives you, in any of the usual shapes:
 * plain JSON, or the JS snippet (`const firebaseConfig = { apiKey: "…", … };`).
 * Throws an Error with a human-readable message when it isn't usable.
 */
export function parseFirebaseConfig(input: string): FirebaseWebConfig {
  const start = input.indexOf('{')
  const end = input.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error("That doesn't look like a Firebase config — no { … } object found.")
  const body = input.slice(start, end + 1)

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(body)
  } catch {
    try {
      // The JS snippet: unquoted keys, single quotes, trailing commas.
      raw = JSON.parse(
        body
          .replace(/(^|[{,])\s*\/\/[^\n]*/gm, '$1') // line comments — not the // inside URLs
          .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
          .replace(/'([^']*)'/g, '"$1"')
          .replace(/,\s*([}\]])/g, '$1')
      )
    } catch {
      throw new Error("Couldn't read that as JSON. Paste the firebaseConfig object from Firebase Console.")
    }
  }

  if (raw.type === 'service_account' || 'private_key' in raw) {
    throw new Error(
      'This is a service-account key (it contains a private key) — never upload that to a website. ' +
        'Use the Web app config instead: Project settings → General → Your apps → Web app → SDK setup and configuration.'
    )
  }
  if ('project_info' in raw) {
    throw new Error(
      "This is the Android google-services.json. You need the Web app config: Project settings → Your apps → add a Web app (</>)."
    )
  }
  // Some people paste `{ "firebaseConfig": { … } }`.
  if (raw.firebaseConfig && typeof raw.firebaseConfig === 'object') raw = raw.firebaseConfig as Record<string, unknown>

  const missing = REQUIRED.filter((k) => typeof raw[k] !== 'string' || !(raw[k] as string).trim())
  if (missing.length) throw new Error(`The config is missing: ${missing.join(', ')}.`)

  const out: Record<string, string> = {}
  for (const k of KNOWN) {
    if (typeof raw[k] === 'string' && (raw[k] as string).trim()) out[k] = (raw[k] as string).trim()
  }
  return out as unknown as FirebaseWebConfig
}

/**
 * Resolve which Firebase project to talk to, in order:
 *  1. `firebase-config.json` deployed next to the app (the real, team-wide setting)
 *  2. a config saved in THIS browser from the Setup screen (for trying it out
 *     before deploying the file)
 * Returns null when neither exists — main.tsx then shows the Setup screen.
 */
export async function loadFirebaseConfig(): Promise<FirebaseWebConfig | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}firebase-config.json`, { cache: 'no-store' })
    // Hosting with an SPA rewrite answers a missing file with index.html —
    // parseFirebaseConfig rejects that, which is what we want.
    if (res.ok) current = parseFirebaseConfig(await res.text())
  } catch {
    /* no deployed file — fall through */
  }
  if (!current) {
    try {
      const saved = localStorage.getItem(LOCAL_KEY)
      if (saved) current = parseFirebaseConfig(saved)
    } catch {
      /* storage blocked or bad value */
    }
  }
  return current
}

export function getFirebaseConfig(): FirebaseWebConfig {
  if (!current) throw new Error('Firebase config not loaded — loadFirebaseConfig() must run first (see main.tsx).')
  return current
}

export function getAppName(): string {
  return current?.appName || 'Task Manager'
}

export function saveLocalFirebaseConfig(config: FirebaseWebConfig) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(config))
}

export function clearLocalFirebaseConfig() {
  try {
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    /* nothing to clear */
  }
}

// Cloud Messaging → Project Settings → Cloud Messaging → Web Push
// certificates → Generate key pair. Needed for push notifications.
export const vapidKey = 'PASTE_YOUR_VAPID_KEY_HERE'
