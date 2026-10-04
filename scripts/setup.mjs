#!/usr/bin/env node
// One-time setup for a new customer's Firebase project.
//
//   npm run setup -- path/to/firebase-config.json [--no-deploy]
//
// 1. Validates the Firebase *web* config (same rules as the in-app Setup screen)
// 2. Writes it to public/firebase-config.json — the file the app loads at runtime
// 3. Points .firebaserc at that project
// 4. Deploys Firestore rules + indexes and Storage rules (needs `firebase login`)
//
// No dependencies beyond Node 20 — firebase-tools is run through npx.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const deploy = !args.includes('--no-deploy')

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

if (!file) fail('Usage: npm run setup -- path/to/firebase-config.json [--no-deploy]')
if (!existsSync(file)) fail(`File not found: ${file}`)

// Mirrors parseFirebaseConfig() in src/lib/firebase/config.ts.
function parse(input) {
  const start = input.indexOf('{')
  const end = input.lastIndexOf('}')
  if (start < 0 || end < start) fail('No { … } object found in that file.')
  const body = input.slice(start, end + 1)
  let raw
  try {
    raw = JSON.parse(body)
  } catch {
    try {
      raw = JSON.parse(
        body
          .replace(/(^|[{,])\s*\/\/[^\n]*/gm, '$1') // line comments — not the // inside URLs
          .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
          .replace(/'([^']*)'/g, '"$1"')
          .replace(/,\s*([}\]])/g, '$1')
      )
    } catch {
      fail("Couldn't parse that file as JSON or as the firebaseConfig JS snippet.")
    }
  }
  if (raw.type === 'service_account' || 'private_key' in raw) {
    fail('That is a service-account key — do NOT ship it with the app. Use the Web app config from Project settings → Your apps.')
  }
  if ('project_info' in raw) fail('That is the Android google-services.json — you need the Web app config.')
  if (raw.firebaseConfig && typeof raw.firebaseConfig === 'object') raw = raw.firebaseConfig

  const required = ['apiKey', 'authDomain', 'projectId', 'appId']
  const missing = required.filter((k) => typeof raw[k] !== 'string' || !raw[k].trim())
  if (missing.length) fail(`Config is missing: ${missing.join(', ')}`)

  const known = [...required, 'storageBucket', 'messagingSenderId', 'measurementId', 'appName']
  return Object.fromEntries(known.filter((k) => typeof raw[k] === 'string' && raw[k].trim()).map((k) => [k, raw[k].trim()]))
}

const config = parse(readFileSync(file, 'utf8'))
const target = resolve(root, 'public', 'firebase-config.json')
writeFileSync(target, JSON.stringify(config, null, 2) + '\n')
console.log(`✓ Wrote public/firebase-config.json (project: ${config.projectId})`)

writeFileSync(resolve(root, '.firebaserc'), JSON.stringify({ projects: { default: config.projectId } }, null, 2) + '\n')
console.log('✓ Pointed .firebaserc at it')

if (deploy) {
  const only = config.storageBucket ? 'firestore:rules,firestore:indexes,storage' : 'firestore:rules,firestore:indexes'
  console.log(`\n→ Deploying ${only} to ${config.projectId} (run \`npx firebase-tools login\` first if this fails)…\n`)
  const res = spawnSync('npx', ['--yes', 'firebase-tools', 'deploy', '--only', only, '--project', config.projectId], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (res.status !== 0) fail('Deploy failed — see the output above. Re-run with the same command once fixed.')
  console.log('\n✓ Security rules and indexes are live')
}

console.log(`
Next:
  1. Firebase Console → Authentication → Sign-in method → enable Google
  2. Authentication → Settings → Authorized domains → add the domain you host the app on
  3. npm run build, then deploy dist/ (Firebase Hosting: npx firebase-tools deploy --only hosting)
  4. Open the app and sign in — the FIRST account to sign in becomes the workspace owner
`)
