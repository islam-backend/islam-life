// One-time migration: bring the old (vanilla-app) Firestore documents up to
// the schema the new React app expects.
//
//   tasks:    notes→description, endDate→dueDate, taskHoursSpent→hoursLogged,
//             status "doing"→"in_progress", + denormalized clientId/clientName/
//             projectId/projectName, + orderIndex/hoursLogged defaults
//   projects: + clientId/clientName/totalHours, status default "active"
//   clients:  + archived:false
//
// Auth: same as migrate-multi-assignee.js (FIREBASE_SERVICE_ACCOUNT env,
// scripts/serviceAccount.json, or your `firebase login` session).
//
//   npm run migrate:schema
//
// Idempotent — re-running only patches what's still missing/old.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createSign } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PROJECT_ID = 'islam-life-e126e'
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
const CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'
const here = dirname(fileURLToPath(import.meta.url))

// ── auth ─────────────────────────────────────────────────────────
async function saToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned =
    `${b64({ alg: 'RS256', typ: 'JWT' })}.` +
    b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
  const assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`sa token: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}
async function refreshToken(rt) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLI_CLIENT_ID, client_secret: CLI_CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' }),
  })
  if (!res.ok) throw new Error(`refresh: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}
async function getToken() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return saToken(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  try {
    return await saToken(JSON.parse(readFileSync(join(here, 'serviceAccount.json'), 'utf8')))
  } catch (e) {
    if (e.message.startsWith('sa token')) throw e
  }
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'))
    if (cfg.tokens?.refresh_token) return refreshToken(cfg.tokens.refresh_token)
  } catch {
    /* */
  }
  throw new Error('No credentials. Run `firebase login` or add scripts/serviceAccount.json.')
}

// ── value helpers ────────────────────────────────────────────────
const S = (s) => ({ stringValue: s })
const rd = (f) =>
  f == null
    ? undefined
    : f.stringValue ??
      (f.integerValue != null ? Number(f.integerValue) : undefined) ??
      f.booleanValue ??
      f.timestampValue ??
      (f.nullValue === null ? null : undefined)

const token = await getToken()
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function runQuery(collectionId) {
  const res = await fetch(`${DB}:runQuery`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }] } }),
  })
  if (!res.ok) throw new Error(`runQuery ${collectionId}: ${res.status} ${await res.text()}`)
  return (await res.json()).filter((r) => r.document).map((r) => r.document)
}

async function patch(name, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')
  const res = await fetch(`https://firestore.googleapis.com/v1/${name}?${mask}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`patch ${name}: ${res.status} ${await res.text()}`)
}

// short id -> name maps
function shortId(name) {
  return name.split('/').pop()
}
function pathParts(name) {
  const p = name.split('/documents/')[1].split('/')
  return { clientId: p[1], projectId: p[3], taskId: p[5] }
}

// ── clients ──────────────────────────────────────────────────────
const clients = await runQuery('clients') // includes only /clients/* (top level)
const clientName = {}
let cFixed = 0
for (const d of clients) {
  clientName[shortId(d.name)] = rd(d.fields.name) || 'Client'
  if (d.fields.archived === undefined) {
    await patch(d.name, { archived: { booleanValue: false } })
    cFixed++
  }
}
console.log(`clients: ${clients.length} total, ${cFixed} backfilled archived`)

// ── projects ─────────────────────────────────────────────────────
const projects = await runQuery('projects')
const projectName = {}
let pFixed = 0
for (const d of projects) {
  const { clientId } = pathParts(d.name)
  projectName[shortId(d.name)] = rd(d.fields.name) || 'Project'
  const f = d.fields
  const upd = {}
  if (f.clientId === undefined) upd.clientId = S(clientId)
  if (f.clientName === undefined) upd.clientName = S(clientName[clientId] || 'Client')
  if (f.totalHours === undefined) upd.totalHours = { integerValue: '0' }
  const st = rd(f.status)
  if (!['active', 'paused', 'done'].includes(st)) upd.status = S('active')
  if (Object.keys(upd).length) {
    await patch(d.name, upd)
    pFixed++
  }
}
console.log(`projects: ${projects.length} total, ${pFixed} patched`)

// ── tasks ────────────────────────────────────────────────────────
const tasks = await runQuery('tasks')
let tFixed = 0
for (const d of tasks) {
  const { clientId, projectId } = pathParts(d.name)
  const f = d.fields
  const upd = {}

  if (f.description === undefined) {
    const notes = rd(f.notes)
    upd.description = S(typeof notes === 'string' ? notes : '')
  }
  if (f.dueDate === undefined) {
    upd.dueDate = f.endDate?.timestampValue ? { timestampValue: f.endDate.timestampValue } : { nullValue: null }
  }
  if (f.hoursLogged === undefined) {
    const h = rd(f.taskHoursSpent)
    upd.hoursLogged = { integerValue: String(typeof h === 'number' ? Math.round(h) : 0) }
  }
  if (f.orderIndex === undefined) upd.orderIndex = { integerValue: '0' }
  if (rd(f.status) === 'doing') upd.status = S('in_progress')
  if (f.clientId === undefined) upd.clientId = S(clientId)
  if (f.projectId === undefined) upd.projectId = S(projectId)
  if (f.clientName === undefined) upd.clientName = S(clientName[clientId] || 'Client')
  if (f.projectName === undefined) upd.projectName = S(projectName[projectId] || 'Project')
  if (f.priority === undefined) upd.priority = { nullValue: null }
  if (f.tags === undefined) upd.tags = { arrayValue: {} }

  if (Object.keys(upd).length) {
    await patch(d.name, upd)
    tFixed++
    process.stdout.write(`\rtasks patched ${tFixed}…`)
  }
}
console.log(`\ntasks: ${tasks.length} total, ${tFixed} patched`)
console.log('Done.')
