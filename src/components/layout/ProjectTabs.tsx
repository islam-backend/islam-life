import { NavLink } from 'react-router-dom'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-1 py-2.5 text-[13px] font-medium transition-colors ${
    isActive ? 'border-accent text-text' : 'border-transparent text-text-faint hover:text-text-muted'
  }`

/** Tasks | Notes switcher shown under the TopBar on a project's pages. */
export function ProjectTabs({ clientId, projectId, noteCount }: { clientId: string; projectId: string; noteCount?: number }) {
  const base = `/clients/${clientId}/projects/${projectId}`
  return (
    <nav className="flex shrink-0 items-center gap-5 border-b border-border bg-surface px-6">
      <NavLink to={base} end className={tabClass}>
        Tasks
      </NavLink>
      <NavLink to={`${base}/notes`} className={tabClass}>
        Notes{noteCount ? <span className="ml-1.5 text-[11px] text-text-faint">{noteCount}</span> : null}
      </NavLink>
    </nav>
  )
}
