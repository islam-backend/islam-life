// One-time migration: single `assignedTo` → multi `assignees[]` + `assigneeUids[]`.
//
// Run this ONCE, BEFORE deploying the new firestore.rules — the new rules and
// the members' task queries expect `assigneeUids` to exist on every task.
//
// Auth (tried in order):
//   1. FIREBASE_SERVICE_ACCOUNT='<service-account JSON>' in the env
//   2. scripts/serviceAccount.json
//   3. your `firebase login` session (Firebase CLI refresh token)
//
//   npm run migrate:assignees
//
// Talks to the Firestore REST API directly (no firebase-admin needed).
// Safe to re-run: tasks already migrated (no `assignedTo`) are skipped.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT_ID = 'islam-life-e126e'
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// firebase-tools' public OAuth client (firebase-tools/lib/api.js).
const CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'

const here = dirname(fileURLToPath(import.meta.url))

async function tokenFromServiceAccount(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const { createSign } = await import('node:crypto')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64(header)}.${b64(claim)}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
  const assertion = `${unsigned}.${signature}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`service-account token: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

async function tokenFromRefreshToken(refresh_token) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLI_CLIENT_ID,
      client_secret: CLI_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`refresh token: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

async function getAccessToken() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return tokenFromServiceAccount(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  }
  try {
    return await tokenFromServiceAccount(JSON.parse(readFileSync(join(here, 'serviceAccount.json'), 'utf8')))
  } catch (e) {
    if (e.message.startsWith('service-account token')) throw e
  }
  try {
    const cfg = JSON.parse(
      readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8')
    )
    if (cfg.tokens?.refresh_token) return tokenFromRefreshToken(cfg.tokens.refresh_token)
  } catch {
    /* fall through */
  }
  throw new Error('No credentials. Run `firebase login`, or add scripts/serviceAccount.json.')
}

// ── main ─────────────────────────────────────────────────────────
const token = await getAccessToken()
const auth = { Authorization: `Bearer ${token}` }

// Pull every task via a collection-group query.
const queryRes = await fetch(`${BASE}:runQuery`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    structuredQuery: { from: [{ collectionId: 'tasks', allDescendants: true }] },
  }),
})
if (!queryRes.ok) throw new Error(`runQuery: ${queryRes.status} ${await queryRes.text()}`)
const rows = (await queryRes.json()).filter((r) => r.document)
console.log(`Found ${rows.length} task(s).`)

let migrated = 0
let skipped = 0

for (const { document } of rows) {
  const fields = document.fields || {}
  if (fields.assigneeUids && !fields.assignedTo) {
    skipped++
    continue
  }

  const m = fields.assignedTo?.mapValue?.fields
  const one = m
    ? {
        uid: m.uid?.stringValue ?? '',
        email: m.email?.stringValue ?? '',
        displayName: m.displayName?.stringValue ?? '',
      }
    : null

  const assignees = one
    ? [
        {
          mapValue: {
            fields: {
              uid: { stringValue: one.uid },
              email: { stringValue: one.email },
              displayName: { stringValue: one.displayName },
            },
          },
        },
      ]
    : []
  const assigneeUids = one && one.uid ? [{ stringValue: one.uid }] : []

  // PATCH: write assignees + assigneeUids, and list assignedTo in the mask
  // without a value → deletes it.
  const url =
    `https://firestore.googleapis.com/v1/${document.name}` +
    `?updateMask.fieldPaths=assignees&updateMask.fieldPaths=assigneeUids&updateMask.fieldPaths=assignedTo`
  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        assignees: { arrayValue: { values: assignees } },
        assigneeUids: { arrayValue: { values: assigneeUids } },
      },
    }),
  })
  if (!patchRes.ok) throw new Error(`patch ${document.name}: ${patchRes.status} ${await patchRes.text()}`)
  migrated++
  process.stdout.write(`\rMigrated ${migrated}…`)
}

console.log(`\nDone. Migrated ${migrated}, already-done ${skipped}.`)
