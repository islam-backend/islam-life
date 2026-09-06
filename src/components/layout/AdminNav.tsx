import { Link, useLocation } from 'react-router-dom'

function TeamIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 13c0-2.5 2-4 5-4s5 1.5 5 4M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AssignmentsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function SwatchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

const items = [
  { to: '/admin/team', label: 'Team', Icon: TeamIcon },
  { to: '/admin/assignments', label: 'All Assignments', Icon: AssignmentsIcon },
  { to: '/styleguide', label: 'Design system', Icon: SwatchIcon },
]

export function AdminNav() {
  const location = useLocation()

  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Admin</div>
      {items.map(({ to, label, Icon }) => {
        const active = location.pathname === to
        return (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
              active ? '-ml-[2.5px] border-l-[2.5px] border-accent bg-accent-tint' : ''
            }`}
          >
            <span className={active ? 'text-accent' : 'text-text-muted'}>
              <Icon />
            </span>
            <span className={`text-[13px] ${active ? 'font-semibold text-text' : 'text-text-muted'}`}>{label}</span>
          </Link>
        )
      })}
    </div>
  )
}
