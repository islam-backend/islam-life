import { useState } from 'react'

type StatusBorder = 'green' | 'amber' | 'red' | null

interface AvatarProps {
  name: string | undefined | null
  imageUrl?: string | null
  /** Tailwind bg-* class, e.g. "bg-avatar-a" — ignored when imageUrl loads successfully. */
  colorClass?: string
  size?: number
  statusBorder?: StatusBorder
}

const borderColor: Record<Exclude<StatusBorder, null>, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
}

function initials(name: string | undefined | null) {
  if (!name) return '?'
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  )
}

export function Avatar({ name, imageUrl, colorClass = 'bg-accent', size = 22, statusBorder = null }: AvatarProps) {
  // A dead/blocked image URL (expired Google photo, CORS hiccup, ...)
  // must never leave a broken-image icon sitting in the UI — fall back
  // to the initials circle instead.
  const [imageFailed, setImageFailed] = useState(false)
  const showImage = imageUrl && !imageFailed

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        border: statusBorder ? `2px solid ${borderColor[statusBorder]}` : undefined,
      }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={name || 'avatar'}
          onError={() => setImageFailed(true)}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span className={`flex h-full w-full items-center justify-center rounded-full ${colorClass}`}>
          {initials(name)}
        </span>
      )}
    </span>
  )
}
