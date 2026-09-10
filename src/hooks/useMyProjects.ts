import { useMemo } from 'react'

import type { AssignedProject } from '../types/member'
import { useMyTasks } from './useMyTasks'

/**
 * The distinct client/project pairs the user has at least one assigned
 * task in — derived live from their own tasks. This is what makes a fresh
 * task assignment show up in a member's sidebar with no owner action:
 * visibility follows real assignment, not just the hand-managed
 * `member.assignedProjects` grant list.
 */
export function useMyProjects(uid: string | undefined) {
  const { tasks, loading } = useMyTasks(uid)

  const projects = useMemo<AssignedProject[]>(() => {
    const byId = new Map<string, AssignedProject>()
    for (const t of tasks) {
      if (t.projectId && !byId.has(t.projectId)) {
        byId.set(t.projectId, {
          clientId: t.clientId,
          clientName: t.clientName,
          projectId: t.projectId,
          projectName: t.projectName,
        })
      }
    }
    return Array.from(byId.values())
  }, [tasks])

  return { projects, loading }
}
