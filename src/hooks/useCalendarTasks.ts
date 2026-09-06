import { useAllTasks } from './useAllTasks'
import { useAuth } from './useAuth'
import { useMyTasks } from './useMyTasks'
import { isOwnerRole } from '../utils/role'

/** Tasks to show on the calendar — the owner sees everything, a member
 * sees only tasks assigned to them. */
export function useCalendarTasks() {
  const { user, member } = useAuth()
  const isOwner = isOwnerRole(member?.role)

  const all = useAllTasks(isOwner)
  const mine = useMyTasks(isOwner ? undefined : user?.uid)

  return isOwner ? all : mine
}
