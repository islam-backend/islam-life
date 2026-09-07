import { type KeyboardEvent, useRef, useState } from 'react'

import type { Member } from '../../types/member'
import { Avatar } from '../ui/Avatar'

export function nameOf(m: Member) {
  return m.displayName || m.email
}

/** Single-line message box with an @-mention menu. Type `@` then a name;
 * ↑/↓ + Enter/Tab picks. Enter with the menu closed submits the form. */
export function MentionTextInput({
  value,
  onChange,
  members,
  disabled,
  placeholder,
}: {
  value: string
  /** `addedUid` is set when a pick just inserted a mention. */
  onChange: (value: string, addedUid?: string) => void
  members: Member[]
  disabled?: boolean
  placeholder?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const matches =
    query === null
      ? []
      : members
          .filter((m) => nameOf(m).toLowerCase().includes(query.toLowerCase()))
          .slice(0, 6)

  function syncQuery(v: string, caret: number) {
    const m = v.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,30})$/)
    setQuery(m ? m[1] : null)
    setActive(0)
  }

  function pick(m: Member) {
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const before = value.slice(0, caret).replace(/@([^\s@]*)$/, `@${nameOf(m)} `)
    const after = value.slice(caret)
    onChange(before + after, m.uid)
    setQuery(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(before.length, before.length)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (query !== null && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a + 1) % matches.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a - 1 + matches.length) % matches.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(matches[active])
      } else if (e.key === 'Escape') {
        setQuery(null)
      }
    }
  }

  return (
    <div className="relative flex-1">
      {query !== null && matches.length > 0 && (
        <div className="absolute bottom-full mb-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {matches.map((m, i) => (
            <button
              key={m.uid}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] ${
                i === active ? 'bg-accent-tint text-accent-tint-text' : 'text-text-muted hover:bg-field'
              }`}
            >
              <Avatar name={nameOf(m)} imageUrl={m.avatarUrl} size={20} colorClass="bg-avatar-b" />
              <span className="truncate">{nameOf(m)}</span>
            </button>
          ))}
        </div>
      )}
      <input
        ref={ref}
        dir="auto"
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          syncQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery(null)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-field px-3.5 py-2 text-[13px] text-text outline-none focus:border-accent disabled:opacity-60"
      />
    </div>
  )
}
