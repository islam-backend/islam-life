// Push-relay Worker — the one piece of server-side code this app needs for
// "real" push (when the app is backgrounded or fully closed). Everything
// else lives in the Firebase project, but Firebase Cloud Functions needs a
// paid (Blaze) plan even to stay within the free tier, which this workspace
// deliberately avoids — see IslamLifeV2/src/lib/firebase/config.ts and the
// "no Cloud Functions" decision. A Cloudflare Worker is free, has no
// framework/package to maintain (zero npm dependencies — just fetch() and
// Web Crypto, both built into the Workers runtime), and the client calls it
// directly right after writing to Firestore (see src/lib/activityLog.ts).
//
// What it does, each request:
//   1. Checks the shared secret header (not real security — the real
//      security is Firestore rules; this just keeps randoms who find the
//      URL from running up the Firebase/FCM quota).
//   2. Exchanges the Firebase Admin service account for a short-lived Google
//      OAuth2 access token (signed JWT — RS256 via Web Crypto, no library).
//   3. Looks up each recipient's FCM device token from Firestore (REST API).
//   4. Sends them a push via FCM's HTTP v1 API.
//
// Deploy / configure: see ../README.md. Nothing here needs editing per
// deployment — the two secrets (FIREBASE_SERVICE_ACCOUNT, APP_SHARED_SECRET)
// carry everything project-specific.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function base64Url(bytes) {
  let str = typeof bytes === 'string' ? btoa(bytes) : btoa(String.fromCharCode(...new Uint8Array(bytes)))
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importPrivateKey(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

async function signServiceAccountJwt(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`
  const key = await importPrivateKey(serviceAccount.private_key)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  return `${unsigned}.${base64Url(signature)}`
}

// Cached per-isolate — Workers can reuse an isolate across requests, so this
// saves a round trip to Google most of the time. Safe to lose on cold start.
let cachedAccessToken = null

async function getAccessToken(serviceAccount) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value
  }
  const assertion = await signServiceAccountJwt(
    serviceAccount,
    'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging'
  )
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`OAuth2 token exchange failed: ${JSON.stringify(data)}`)
  cachedAccessToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cachedAccessToken.value
}

async function getFcmToken(projectId, uid, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/members/${uid}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) return null
  const doc = await res.json()
  return doc.fields?.fcmToken?.stringValue || null
}

async function sendFcm(projectId, deviceToken, accessToken, { title, body, url }) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title, body },
        ...(url ? { data: { url } } : {}),
        android: { priority: 'high' },
      },
    }),
  })
  return res.ok
}

// Hard cap — this is a small-team internal tool, never meant to fan out to
// a real audience. Catches a buggy caller before it burns FCM/Firestore quota.
const MAX_RECIPIENTS = 25

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    if (!env.APP_SHARED_SECRET || request.headers.get('X-App-Secret') !== env.APP_SHARED_SECRET) {
      return json({ error: 'unauthorized' }, 401)
    }

    let payload
    try {
      payload = await request.json()
    } catch {
      return json({ error: 'bad json' }, 400)
    }

    const { uids, title, body, url } = payload || {}
    if (!Array.isArray(uids) || uids.length === 0 || typeof title !== 'string' || typeof body !== 'string') {
      return json({ error: 'expected { uids: string[], title: string, body: string, url?: string }' }, 400)
    }

    let serviceAccount
    try {
      // Strip a leading UTF-8 BOM — easy to pick up however the secret got
      // set (a text editor, a shell redirect, Windows tools in particular).
      serviceAccount = JSON.parse((env.FIREBASE_SERVICE_ACCOUNT || '').replace(/^﻿/, ''))
    } catch {
      return json({ error: 'worker misconfigured: FIREBASE_SERVICE_ACCOUNT' }, 500)
    }
    const projectId = serviceAccount.project_id

    let accessToken
    try {
      accessToken = await getAccessToken(serviceAccount)
    } catch (err) {
      return json({ error: `auth failed: ${err.message}` }, 502)
    }

    let sent = 0
    for (const uid of uids.slice(0, MAX_RECIPIENTS)) {
      if (typeof uid !== 'string' || !uid) continue
      const deviceToken = await getFcmToken(projectId, uid, accessToken)
      if (!deviceToken) continue
      if (await sendFcm(projectId, deviceToken, accessToken, { title, body, url })) sent++
    }

    return json({ sent })
  },
}
