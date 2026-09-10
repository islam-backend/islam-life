import { useAllTasks } from './useAllTasks'
import { useAuth } from './useAuth'
import { useMyTasks } from './useMyTasks'
import { isManagerRole, isOwnerRole } from '../utils/role'

/** Tasks to show on the calendar:
 *  - owner   → every task
 *  - manager → every task in the clients they manage
 *  - member  → only tasks assigned to them */
export function useCalendarTasks() {
  const { user, member } = useAuth()
  const isOwner = isOwnerRole(member?.role)
  const isManager = isManagerRole(member?.role)
  const managedClientIds = member?.managedClientIds ?? []

  const all = useAllTasks(isOwner)
  const scoped = useAllTasks(isManager && managedClientIds.length > 0, managedClientIds)
  const mine = useMyTasks(isOwner || isManager ? undefined : user?.uid)

  if (isOwner) return all
  if (isManager) return scoped
  return mine
}
