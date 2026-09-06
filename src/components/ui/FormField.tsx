import type { ReactNode } from 'react'

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-text-faint">{label}</span>
      {children}
    </label>
  )
}
