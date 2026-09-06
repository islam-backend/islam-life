// One-time migration: single `assignedTo` → multi `assignees[]` + `assigneeUids[]`.
//
// Run this ONCE, BEFORE deploying the new firestore.rules — the new rules and
// the members' task queries expect `assigneeUids` to exist on every task.
//
//   FIREBASE_SERVICE_ACCOUNT='<full service-account JSON>' node migrate-multi-assignee.js
//
// Safe to re-run: tasks already migrated (no `assignedTo` field) are skipped.

import admin from 'firebase-admin';

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Missing required env var: FIREBASE_SERVICE_ACCOUNT');
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }
  admin.initializeApp({ credential: admin.credential.cert(creds) });
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
