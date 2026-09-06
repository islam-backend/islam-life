const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore();

// ── Keep task.hoursLogged / project.totalHours in sync with focus
// sessions, computed server-side (never trust a client-sent increment).
// Handles create (+hours), delete (-hours) and update (net delta,
// including a session moved to a different task/project) uniformly by
// applying the before-delta and after-delta separately.
exports.aggregateFocusSession = onDocumentWritten('focusSessions/{sessionId}', async (event) => {
  const before = event.data.before?.exists ? event.data.before.data() : null;
  const after  = event.data.after?.exists  ? event.data.after.data()  : null;

  const deltas = new Map(); // doc path -> hours delta

  function addDelta(session, sign) {
    if (!session?.clientId || !session?.projectId) return;
    const hours = (session.hours || 0) * sign;
    if (!hours) return;

    const projectPath = `clients/${session.clientId}/projects/${session.projectId}`;
    deltas.set(projectPath, (deltas.get(projectPath) || 0) + hours);

    if (session.taskId) {
      const taskPath = `${projectPath}/tasks/${session.taskId}`;
      deltas.set(taskPath, (deltas.get(taskPath) || 0) + hours);
    }
  }

  addDelta(before, -1);
  addDelta(after, 1);

  await Promise.all(
    Array.from(deltas.entries())
      .filter(([, hours]) => hours !== 0)
      .map(([path, hours]) => {
        const field = path.includes('/tasks/') ? 'hoursLogged' : 'totalHours';
        return db.doc(path).update({ [field]: FieldValue.increment(hours) }).catch((err) => {
          console.error(`aggregateFocusSession: failed to update ${field} on ${path}:`, err.message);
        });
      })
  );

  return null;
});
