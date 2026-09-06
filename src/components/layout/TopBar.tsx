import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Crumb {
  label: string
  to?: string
}

export function TopBar({ crumbs, actions }: { crumbs: Crumb[]; actions?: ReactNode }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-text-faint">/</span>}
            {c.to ? (
              <Link to={c.to} className="text-text-muted hover:text-text">
                {c.label}
              </Link>
            ) : (
              <span className="font-semibold text-text">{c.label}</span>
            )}
          </span>
        ))}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  )
}
