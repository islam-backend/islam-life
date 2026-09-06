// One-time migration: single `assignedTo` → multi `assignees[]` + `assigneeUids[]`.
//
// Run this ONCE, BEFORE deploying the new firestore.rules — the new rules and
// the members' task queries expect `assigneeUids` to exist on every task.
//
// Credentials (either one):
//   - a service-account key file at scripts/serviceAccount.json, OR
//   - FIREBASE_SERVICE_ACCOUNT='<full service-account JSON>' in the env
//   (Firebase Console → Project settings → Service accounts → Generate new private key)
//
//   npm run migrate:assignees
//
// Safe to re-run: tasks already migrated (no `assignedTo` field) are skipped.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import admin from 'firebase-admin';

function loadCreds() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
    }
  }
  const file = join(dirname(fileURLToPath(import.meta.url)), 'serviceAccount.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error(
      'No credentials. Put a service-account key at scripts/serviceAccount.json or set FIREBASE_SERVICE_ACCOUNT.'
    );
  }
}

function initFirebase() {
  admin.initializeApp({ credential: admin.credential.cert(loadCreds()) });
  return admin.firestore();
}

const db = initFirebase();
const { FieldValue } = admin.firestore;

const snap = await db.collectionGroup('tasks').get();
console.log(`Found ${snap.size} task(s).`);

let migrated = 0;
let batch = db.batch();
let ops = 0;

for (const doc of snap.docs) {
  const data = doc.data();

  // Already migrated?
  if (Array.isArray(data.assigneeUids) && !('assignedTo' in data)) continue;

  const single = data.assignedTo;
  const assignees =
    single && single.uid
      ? [{ uid: single.uid, email: single.email ?? '', displayName: single.displayName ?? '' }]
      : [];

  batch.update(doc.ref, {
    assignees,
    assigneeUids: assignees.map((a) => a.uid),
    assignedTo: FieldValue.delete(),
  });
  migrated++;
  ops++;

  if (ops >= 400) {
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }
}

if (ops > 0) await batch.commit();

console.log(`Migrated ${migrated} task(s). Done.`);
process.exit(0);
