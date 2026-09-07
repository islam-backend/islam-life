import { Fragment } from 'react'

/** Renders chat text, highlighting `@Name` runs that match a known member. */
export function MessageText({ text, mentionNames }: { text: string; mentionNames: string[] }) {
  if (!text) return null
  if (mentionNames.length === 0) {
    return <span className="block whitespace-pre-wrap break-words">{text}</span>
  }

  // longest name first so "@Omar Wael" wins over "@Omar"
  const names = [...mentionNames].sort((a, b) => b.length - a.length)
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(@(?:${escaped.join('|')}))`, 'g')
  const isMention = new Set(names.map((n) => `@${n}`))

  return (
    <span dir="auto" className="block whitespace-pre-wrap break-words">
      {text.split(re).map((part, i) =>
        isMention.has(part) ? (
          <span key={i} className="font-semibold underline underline-offset-2">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </span>
  )
}
