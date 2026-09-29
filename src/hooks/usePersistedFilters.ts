import { useEffect, useState } from 'react'

import { DEFAULT_TASK_FILTERS, type TaskFilters } from '../components/layout/FilterBar'

function load(key: string): TaskFilters {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? { ...DEFAULT_TASK_FILTERS, ...JSON.parse(raw) } : DEFAULT_TASK_FILTERS
  } catch {
    return DEFAULT_TASK_FILTERS
  }
}

/**
 * Task filters that survive opening a task and coming back (the list page
 * unmounts while the task page is open). Kept per `key` — e.g. one per
 * project — for this browser tab's session only.
 */
export function usePersistedFilters(key: string) {
  const [state, setState] = useState(() => ({ key, filters: load(key) }))

  // Switching project (same page component, new key) loads that key's filters.
  const filters = state.key === key ? state.filters : load(key)
  useEffect(() => {
    if (state.key !== key) setState({ key, filters: load(key) })
  }, [key, state.key])

  function setFilters(next: TaskFilters) {
    setState({ key, filters: next })
    try {
      sessionStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* storage blocked — filters just won't persist */
    }
  }

  return [filters, setFilters] as const
}
