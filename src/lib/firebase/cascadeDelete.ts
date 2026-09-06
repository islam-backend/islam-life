import { type DocumentReference, collection, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore'

import { db } from './app'

/** Firestore batches cap at 500 ops — commit in safe-sized chunks. */
async function deleteRefsInChunks(refs: DocumentReference[]) {
  const CHUNK = 450
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const ref of refs.slice(i, i + CHUNK)) batch.delete(ref)
    await batch.commit()
  }
}

/** A task doc plus its subtasks/comments subcollections. */
async function collectTaskRefs(clientId: string, projectId: string, taskId: string): Promise<DocumentReference[]> {
  const taskRef = doc(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId)
  const [subtasks, comments] = await Promise.all([
    getDocs(collection(taskRef, 'subtasks')),
    getDocs(collection(taskRef, 'comments')),
  ])
  return [...subtasks.docs.map((d) => d.ref), ...comments.docs.map((d) => d.ref), taskRef]
}

/** Deletes one task along with its subtasks/comments (chat images live
 * inside the comment docs, so they go with them). */
export async function deleteTaskCascade(clientId: string, projectId: string, taskId: string) {
  await deleteRefsInChunks(await collectTaskRefs(clientId, projectId, taskId))
}

/** Deletes a project's tasks (with their subtasks/comments), then the project itself. */
export async function deleteProjectCascade(clientId: string, projectId: string) {
  const tasksSnap = await getDocs(collection(db, 'clients', clientId, 'projects', projectId, 'tasks'))
  const taskRefGroups = await Promise.all(
    tasksSnap.docs.map((t) => collectTaskRefs(clientId, projectId, t.id))
  )
  const projectRef = doc(db, 'clients', clientId, 'projects', projectId)
  await deleteRefsInChunks([...taskRefGroups.flat(), projectRef])
}

/** Deletes every project under a client (cascading through tasks), then the client itself. */
export async function deleteClientCascade(clientId: string) {
  const projectsSnap = await getDocs(collection(db, 'clients', clientId, 'projects'))
  for (const p of projectsSnap.docs) {
    await deleteProjectCascade(clientId, p.id)
  }
  await deleteRefsInChunks([doc(db, 'clients', clientId)])
}

/** Renames a project — and every one of its tasks' denormalized `projectName`,
 * so the Admin assignments table and task rows don't show a stale name. */
export async function renameProject(clientId: string, projectId: string, newName: string) {
  const tasksSnap = await getDocs(collection(db, 'clients', clientId, 'projects', projectId, 'tasks'))
  await Promise.all(tasksSnap.docs.map((t) => updateDoc(t.ref, { projectName: newName })))
  await updateDoc(doc(db, 'clients', clientId, 'projects', projectId), { name: newName })
}

/** Renames a client — cascading the denormalized `clientName` onto every one
 * of its projects and every task inside them. */
export async function renameClient(clientId: string, newName: string) {
  const projectsSnap = await getDocs(collection(db, 'clients', clientId, 'projects'))
  for (const p of projectsSnap.docs) {
    const tasksSnap = await getDocs(collection(db, 'clients', clientId, 'projects', p.id, 'tasks'))
    await Promise.all(tasksSnap.docs.map((t) => updateDoc(t.ref, { clientName: newName })))
    await updateDoc(p.ref, { clientName: newName })
  }
  await updateDoc(doc(db, 'clients', clientId), { name: newName })
}
