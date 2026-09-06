import type { ReactNode } from 'react'

export function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-[min(560px,92vw)] overflow-y-auto rounded-xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
