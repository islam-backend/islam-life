import type { TaskPriority } from '../types/task'

interface PriorityMeta {
  label: string
  /** Tailwind classes for the pill. */
  bg: string
  text: string
  dot: string
  /** Higher = more urgent. Used for sorting; "no priority" is 0. */
  weight: number
}

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  urgent: { label: 'Urgent', bg: 'bg-red-tint', text: 'text-red-tint-text', dot: 'bg-red', weight: 4 },
  high: { label: 'High', bg: 'bg-amber-tint', text: 'text-amber-tint-text', dot: 'bg-amber', weight: 3 },
  medium: { label: 'Medium', bg: 'bg-accent-tint', text: 'text-accent-tint-text', dot: 'bg-accent', weight: 2 },
  low: { label: 'Low', bg: 'bg-field', text: 'text-text-muted', dot: 'bg-text-faint', weight: 1 },
}

export const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'medium', 'low']

export function priorityWeight(p: TaskPriority | null | undefined): number {
  return p ? PRIORITY_META[p]?.weight ?? 0 : 0
}
