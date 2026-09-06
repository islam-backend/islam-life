import type { SelectHTMLAttributes } from 'react'

/**
 * The one <select> style for the whole app. Native <select> (keeps
 * keyboard + mobile behaviour) with the browser chevron removed and a
 * consistent chevron + fill drawn on top.
 */
export function Select({
  size = 'md',
  className = '',
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'sm' | 'md' }) {
  const sizing =
    size === 'sm' ? 'py-1.5 pl-2.5 pr-8 text-[12.5px]' : 'py-2 pl-3 pr-9 text-[13px]'

  return (
    <div className="relative inline-flex w-fit">
      <select
        {...props}
        className={`w-full cursor-pointer appearance-none rounded-lg border border-border bg-field font-medium text-text outline-none transition-colors hover:border-text-faint focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-default disabled:opacity-60 ${sizing} ${className}`}
      >
        {children}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
