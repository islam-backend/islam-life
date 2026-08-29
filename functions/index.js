const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp }    = require('firebase-admin/app');
const { getFirestore }     = require('firebase-admin/firestore');
const { getMessaging }     = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

// ── Notify team member when a task is assigned to them ─────────
exports.notifyTaskAssigned = onDocumentWritten(
  'clients/{clientId}/projects/{projectId}/tasks/{taskId}',
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};

    // Only act when assignedTo.email is newly set or changed
    const prevEmail = before.assignedTo?.email || null;
    const newEmail  = after.assignedTo?.email  || null;
    if (!newEmail || prevEmail === newEmail) return null;

    // Look up the member's FCM token
    const snap = await db
      .collection('teamMembers')
      .where('email', '==', newEmail)
      .limit(1)
      .get();
    if (snap.empty) return null;

    const memberData = snap.docs[0].data();
    const token      = memberData.fcmToken;
    if (!token) return null; // member hasn't opened the app yet / denied permission

    const taskTitle = after.title || 'مهمة جديدة';

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
      console.log(`Notification sent to ${newEmail} for task "${taskTitle}"`);
    } catch (err) {
      // Token might be stale — clear it so we don't keep failing
      if (err.code === 'messaging/registration-token-not-registered') {
        await snap.docs[0].ref.update({ fcmToken: null });
        console.log(`Cleared stale FCM token for ${newEmail}`);
      } else {
        console.error('FCM send error:', err);
      }
    }

    return null;
  }
);
