const { initializeApp } = require('firebase-admin/app');

initializeApp();

// One initializeApp() for the whole functions codebase; each module
// below just calls getFirestore()/getMessaging() and gets this app.
//
// Note: invite-only sign-in is enforced entirely by firestore.rules
// (members/{uid} can only be self-created if the email is in invites/)
// — no Cloud Function / Identity Platform needed for that anymore.
exports.notifyTaskAssigned    = require('./notifications').notifyTaskAssigned;
exports.aggregateFocusSession = require('./aggregation').aggregateFocusSession;
