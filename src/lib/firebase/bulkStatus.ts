import { serverTimestamp, writeBatch } from 'firebase/firestore'

import type { Task, TaskStatus } from '../../types/task'
import { logActivity, taskChangeEntries } from '../activityLog'
import { db } from './app'
import { taskDocRef } from './refs'

/** Move many tasks to one status. Batches cap at 500 ops — chunk to be safe. */
export async function moveTasksToStatus(tasks: Task[], status: TaskStatus) {
  const toMove = tasks.filter((t) => t.status !== status)
  const CHUNK = 450
  for (let i = 0; i < toMove.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const t of toMove.slice(i, i + CHUNK)) {
      batch.update(taskDocRef(t.clientId, t.projectId, t.id), { status, updatedAt: serverTimestamp() })
    }
    await batch.commit()
  }
  void logActivity(toMove.flatMap((t) => taskChangeEntries(t, { ...t, status })))
}
