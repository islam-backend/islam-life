import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface Crumb {
  label: string
  to?: string
}

export function TopBar({ crumbs, actions }: { crumbs: Crumb[]; actions?: ReactNode }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-text-faint">/</span>}
            {c.to ? (
              <Link to={c.to} className="max-w-[220px] truncate text-text-muted hover:text-text hover:underline">
                {c.label}
              </Link>
            ) : (
              <span
                dir="auto"
                className={`max-w-[320px] truncate ${i === crumbs.length - 1 ? 'font-semibold text-text' : 'text-text-muted'}`}
              >
                {c.label}
              </span>
            )}
          </span>
        ))}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  )
}
