import { serverTimestamp, writeBatch } from 'firebase/firestore'

import type { Task, TaskStatus } from '../../types/task'
import { isArchived } from '../../utils/taskStatus'
import { logActivity, taskChangeEntries } from '../activityLog'
import { db } from './app'
import { taskDocRef } from './refs'

const CHUNK = 450 // batches cap at 500 ops

async function commitInChunks(tasks: Task[], patchFor: (t: Task) => Partial<Task>) {
  for (let i = 0; i < tasks.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const t of tasks.slice(i, i + CHUNK)) {
      batch.update(taskDocRef(t.clientId, t.projectId, t.id), { ...patchFor(t), updatedAt: serverTimestamp() })
    }
    await batch.commit()
  }
  void logActivity(tasks.flatMap((t) => taskChangeEntries(t, { ...t, ...patchFor(t) })))
}

/** Shelve tasks: hidden everywhere except the Archive page. Remembers each
 * task's current status so Restore can put it back. Owner/manager only. */
export async function archiveTasks(tasks: Task[], byUid: string) {
  await commitInChunks(
    tasks.filter((t) => !isArchived(t)),
    (t) => ({ status: 'archived', archivedFrom: t.status, archivedAt: serverTimestamp(), archivedBy: byUid })
  )
}

/** Bring archived tasks back to the status they had before archiving. */
export async function restoreTasks(tasks: Task[]) {
  await commitInChunks(tasks.filter(isArchived), (t) => ({
    status: (t.archivedFrom && t.archivedFrom !== 'archived' ? t.archivedFrom : 'done') as TaskStatus,
    archivedFrom: null,
    archivedAt: null,
    archivedBy: null,
  }))
}
