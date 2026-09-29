const {
  onDocumentWrittenWithAuthContext,
  onDocumentCreatedWithAuthContext,
  onDocumentDeletedWithAuthContext,
} = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore();

// ── Activity: one place that turns raw Firestore writes into
//   1. auditLog/{id}                  — everything, for the admin Audit Log page
//   2. members/{uid}/notifications    — the subset each person should hear about
//
// The *WithAuthContext triggers tell us WHO made the write (event.authId),
// so the log is trustworthy — clients can't write to auditLog at all (see
// firestore.rules) and no client code has to remember to "log" anything.
//
// Writes by functions themselves (hoursLogged aggregation, stale FCM token
// cleanup) touch only fields we ignore, so they never show up here.
// Assignment notifications (+ FCM push) stay in notifications.js — this
// file still AUDITS assignments but doesn't notify the newly-added people.

const PREVIEW_LEN = 140;

const STATUS_LABEL = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

async function actorOf(event) {
  if (event.authType !== 'app_user' || !event.authId) {
    return { actorUid: null, actorName: 'System' };
  }
  const snap = await db.collection('members').doc(event.authId).get();
  const m = snap.exists ? snap.data() : {};
  return { actorUid: event.authId, actorName: m.displayName || m.email || 'Someone' };
}

function dateStr(ts) {
  const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
  return d ? d.toISOString().slice(0, 10) : null;
}

function sameList(a = [], b = []) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function names(assignees = [], uids) {
  return assignees
    .filter((a) => uids.includes(a.uid))
    .map((a) => a.displayName || a.email)
    .join(', ');
}

function preview(text) {
  const t = (text || '').trim();
  return t.length > PREVIEW_LEN ? `${t.slice(0, PREVIEW_LEN)}…` : t;
}

/**
 * Write the audit entries, then fan out notifications. Per entry,
 * `recipients` get a notification of the entry's own type and `mentioned`
 * get a 'comment.mention' one instead. The actor is always dropped — you
 * don't get notified about your own actions.
 */
async function record(entries, actor) {
  if (entries.length === 0) return;
  const batch = db.batch();
  const notify = (uid, data) =>
    batch.set(db.collection('members').doc(uid).collection('notifications').doc(), { ...data, read: false });
  const others = (uids) => [...new Set(uids)].filter((uid) => uid && uid !== actor.actorUid);

  for (const { recipients = [], mentioned = [], ...entry } of entries) {
    const data = { ...entry, ...actor, createdAt: FieldValue.serverTimestamp() };
    batch.set(db.collection('auditLog').doc(), data);
    const mentionUids = others(mentioned);
    for (const uid of mentionUids) notify(uid, { ...data, type: 'comment.mention' });
    for (const uid of others(recipients).filter((u) => !mentionUids.includes(u))) notify(uid, data);
  }
  await batch.commit();
}

// ── Tasks ────────────────────────────────────────────────────────
exports.logTaskActivity = onDocumentWrittenWithAuthContext(
  'clients/{clientId}/projects/{projectId}/tasks/{taskId}',
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    const t = after || before;
    const { clientId, projectId, taskId } = event.params;

    const base = {
      clientId,
      projectId,
      taskId,
      clientName: t.clientName || '',
      projectName: t.projectName || '',
      taskTitle: t.title || '',
    };
    // Who hears about a change: everyone on the task + whoever created it.
    const watchers = [...(t.assigneeUids || []), t.createdBy].filter(Boolean);
    const entries = [];

    if (!before) {
      entries.push({ ...base, type: 'task.created' });
    } else if (!after) {
      entries.push({ ...base, type: 'task.deleted', recipients: before.assigneeUids || [] });
    } else {
      if (before.title !== after.title) {
        entries.push({ ...base, type: 'task.renamed', from: before.title || '', to: after.title || '', recipients: watchers });
      }
      if (before.status !== after.status) {
        entries.push({
          ...base,
          type: 'task.status',
          from: STATUS_LABEL[before.status] || before.status || '',
          to: STATUS_LABEL[after.status] || after.status || '',
          recipients: watchers,
        });
      }

      const prevUids = before.assigneeUids || [];
      const nextUids = after.assigneeUids || [];
      const added = nextUids.filter((uid) => !prevUids.includes(uid));
      const removed = prevUids.filter((uid) => !nextUids.includes(uid));
      if (added.length) {
        // The added people are notified (with push) by notifyTaskAssigned.
        entries.push({ ...base, type: 'task.assigned', detail: names(after.assignees, added) });
      }
      if (removed.length) {
        entries.push({ ...base, type: 'task.unassigned', detail: names(before.assignees, removed), recipients: removed });
      }

      if ((before.priority || null) !== (after.priority || null)) {
        entries.push({ ...base, type: 'task.priority', from: before.priority || 'none', to: after.priority || 'none', recipients: watchers });
      }
      if (dateStr(before.dueDate) !== dateStr(after.dueDate)) {
        entries.push({ ...base, type: 'task.due_date', from: dateStr(before.dueDate) || 'none', to: dateStr(after.dueDate) || 'none', recipients: watchers });
      }
      if (dateStr(before.startDate) !== dateStr(after.startDate)) {
        entries.push({ ...base, type: 'task.start_date', from: dateStr(before.startDate) || 'none', to: dateStr(after.startDate) || 'none' });
      }
      if ((before.description || '') !== (after.description || '')) {
        entries.push({ ...base, type: 'task.description', recipients: watchers });
      }
      if (!sameList(before.tags, after.tags)) {
        entries.push({ ...base, type: 'task.tags', from: (before.tags || []).join(', '), to: (after.tags || []).join(', ') });
      }
    }

    if (entries.length === 0) return null; // e.g. hoursLogged / orderIndex / denormalized names only
    await record(entries, await actorOf(event));
    return null;
  }
);

async function taskContext(params) {
  const snap = await db
    .doc(`clients/${params.clientId}/projects/${params.projectId}/tasks/${params.taskId}`)
    .get();
  if (!snap.exists) return null; // parent is gone (cascade delete) — nothing worth logging
  const t = snap.data();
  return {
    base: {
      clientId: params.clientId,
      projectId: params.projectId,
      taskId: params.taskId,
      clientName: t.clientName || '',
      projectName: t.projectName || '',
      taskTitle: t.title || '',
    },
    watchers: [...(t.assigneeUids || []), t.createdBy].filter(Boolean),
  };
}

// ── Chat messages ────────────────────────────────────────────────
exports.logCommentActivity = onDocumentCreatedWithAuthContext(
  'clients/{clientId}/projects/{projectId}/tasks/{taskId}/comments/{commentId}',
  async (event) => {
    const c = event.data?.data();
    const ctx = c && (await taskContext(event.params));
    if (!ctx) return null;

    const kind = c.audioUrl ? 'voice' : c.imageUrl ? 'image' : c.fileUrl ? 'file' : 'text';
    await record(
      [
        {
          ...ctx.base,
          type: 'comment.created',
          kind,
          detail: preview(c.text) || c.fileName || '',
          commentId: event.params.commentId,
          recipients: ctx.watchers,
          // Mentioned people get "mentioned you" instead of the generic one.
          mentioned: c.mentions || [],
        },
      ],
      await actorOf(event)
    );
    return null;
  }
);

// ── Files & proof-of-done screenshots ────────────────────────────
exports.logAttachmentActivity = onDocumentWrittenWithAuthContext(
  'clients/{clientId}/projects/{projectId}/tasks/{taskId}/attachments/{attachmentId}',
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (before && after) return null; // attachments are never edited in place
    const a = after || before;
    const ctx = await taskContext(event.params);
    if (!ctx) return null;

    const proof = a.kind === 'proof';
    const type = after ? (proof ? 'proof.added' : 'attachment.added') : proof ? 'proof.deleted' : 'attachment.deleted';
    await record(
      [{ ...ctx.base, type, detail: a.fileName || '', recipients: after ? ctx.watchers : [] }],
      await actorOf(event)
    );
    return null;
  }
);

// ── Clients & projects (audit only) ──────────────────────────────
function nameChangeEntries(kind, before, after, base) {
  if (!before) return [{ ...base, type: `${kind}.created` }];
  if (!after) return [{ ...base, type: `${kind}.deleted` }];
  if ((before.name || '') !== (after.name || '')) {
    return [{ ...base, type: `${kind}.renamed`, from: before.name || '', to: after.name || '' }];
  }
  return [];
}

exports.logClientActivity = onDocumentWrittenWithAuthContext('clients/{clientId}', async (event) => {
  const before = event.data.before?.exists ? event.data.before.data() : null;
  const after = event.data.after?.exists ? event.data.after.data() : null;
  const c = after || before;
  const entries = nameChangeEntries('client', before, after, {
    clientId: event.params.clientId,
    clientName: c.name || '',
  });
  if (entries.length) await record(entries, await actorOf(event));
  return null;
});

exports.logProjectActivity = onDocumentWrittenWithAuthContext(
  'clients/{clientId}/projects/{projectId}',
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    const p = after || before;
    const entries = nameChangeEntries('project', before, after, {
      clientId: event.params.clientId,
      projectId: event.params.projectId,
      clientName: p.clientName || '',
      projectName: p.name || '',
    });
    if (entries.length) await record(entries, await actorOf(event));
    return null;
  }
);

// ── Team: members & invites (owner-only in the Audit Log — no clientId) ──
exports.logMemberActivity = onDocumentWrittenWithAuthContext('members/{uid}', async (event) => {
  const before = event.data.before?.exists ? event.data.before.data() : null;
  const after = event.data.after?.exists ? event.data.after.data() : null;
  const m = after || before;
  const base = { memberUid: event.params.uid, targetName: m.displayName || m.email || '' };
  const entries = [];

  if (!before) entries.push({ ...base, type: 'member.joined', to: m.role || 'member' });
  else if (!after) entries.push({ ...base, type: 'member.removed' });
  else {
    if ((before.role || '') !== (after.role || '')) {
      entries.push({ ...base, type: 'member.role', from: before.role || '', to: after.role || '', recipients: [event.params.uid] });
    }
    const projectIds = (x) => (x.assignedProjects || []).map((p) => p.projectId).sort();
    if (!sameList(projectIds(before), projectIds(after)) || !sameList([...(before.managedClientIds || [])].sort(), [...(after.managedClientIds || [])].sort())) {
      entries.push({ ...base, type: 'member.access', recipients: [event.params.uid] });
    }
  }
  if (entries.length) await record(entries, await actorOf(event));
  return null;
});

exports.logInviteActivity = onDocumentWrittenWithAuthContext('invites/{email}', async (event) => {
  const before = event.data.before?.exists ? event.data.before.data() : null;
  const after = event.data.after?.exists ? event.data.after.data() : null;
  if (before && after) return null;
  const entry = { type: after ? 'invite.created' : 'invite.revoked', targetName: event.params.email };
  if (after) entry.to = after.role || 'member';
  await record([entry], await actorOf(event));
  return null;
});
