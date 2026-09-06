import { type KeyboardEvent, useState } from 'react'

import { normalizeTag, tagColor } from '../../utils/tagColor'

/** Editable multi-select of colored labels — type + Enter (or comma) to add,
 * click the × to remove. */
export function TagsField({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const t = normalizeTag(draft)
    setDraft('')
    if (!t || value.some((v) => v.toLowerCase() === t.toLowerCase())) return
    onChange([...value, t])
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  if (disabled) {
    return value.length ? (
      <span className="flex flex-wrap gap-1.5">
        {value.map((t) => (
          <span key={t} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${tagColor(t)}`}>
            {t}
          </span>
        ))}
      </span>
    ) : (
      <span className="text-[12.5px] text-text-faint">—</span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-field px-2 py-1.5">
      {value.map((t) => (
        <span
          key={t}
          className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${tagColor(t)}`}
        >
          {t}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== t))}
            className="cursor-pointer opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={value.length ? '' : 'أضف تاج…'}
        className="min-w-[80px] flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-text-faint"
      />
    </div>
  )
}
