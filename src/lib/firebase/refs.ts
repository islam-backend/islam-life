import { doc } from 'firebase/firestore'

import { db } from './app'

/** clients/{clientId}/projects/{projectId}/tasks/{taskId} — the one path built in enough
 * places (task detail, admin assignments, notifications) that it deserves a single helper. */
export function taskDocRef(clientId: string, projectId: string, taskId: string) {
  return doc(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId)
}
