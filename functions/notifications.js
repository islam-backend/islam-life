const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const db = getFirestore();

// ── Notify team members when a task is assigned to them ─────────
// A task can now have more than one assignee (assigneeUids[]), so we
// notify everyone who is newly added — not just a single assignedTo.
exports.notifyTaskAssigned = onDocumentWritten(
  'clients/{clientId}/projects/{projectId}/tasks/{taskId}',
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};

    const prevUids = new Set(before.assigneeUids || []);
    const nextUids = after.assigneeUids || [];
    const addedUids = nextUids.filter((uid) => !prevUids.has(uid));
    if (addedUids.length === 0) return null;

    const taskTitle = after.title || 'مهمة جديدة';

    await Promise.all(addedUids.map(async (uid) => {
      const memberRef  = db.collection('members').doc(uid);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) return;

      const token = memberSnap.data().fcmToken;
      if (!token) return; // member hasn't opened the app yet / denied permission

      try {
        await getMessaging().send({
          token,
          notification: {
            title: '📋 مهمة جديدة ليك',
            body:  taskTitle,
          },
          data: {
            taskId:    event.params.taskId,
            projectId: event.params.projectId,
            clientId:  event.params.clientId,
          },
          webpush: {
            notification: {
              title: '📋 مهمة جديدة ليك',
              body:  taskTitle,
              icon:  '/icon-192.png',
              dir:   'rtl',
              requireInteraction: true,
            },
            fcmOptions: { link: '/' },
          },
        });
        console.log(`Notification sent to member ${uid} for task "${taskTitle}"`);
      } catch (err) {
        if (err.code === 'messaging/registration-token-not-registered') {
          await memberRef.update({ fcmToken: null });
          console.log(`Cleared stale FCM token for member ${uid}`);
        } else {
          console.error('FCM send error:', err);
        }
      }
    }));

    return null;
  }
);
