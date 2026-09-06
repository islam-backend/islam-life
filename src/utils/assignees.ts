import type { Member } from '../types/member'
import type { TaskAssignee } from '../types/task'

/** The two fields every task write must set together — `assignees` (rich,
 * for display) and `assigneeUids` (flat, for `array-contains` queries and
 * the `isAssignedToMe` security rule). */
export function assigneeFields(assignees: TaskAssignee[]) {
  return {
    assignees,
    assigneeUids: assignees.map((a) => a.uid),
  }
}

export function memberToAssignee(m: Member): TaskAssignee {
  return { uid: m.uid, email: m.email, displayName: m.displayName }
}
