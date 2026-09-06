// Deterministic color for a tag label — same tag always gets the same
// swatch, no state needed. Uses the app's existing tint tokens.
const PALETTE = [
  'bg-accent-tint text-accent-tint-text',
  'bg-amber-tint text-amber-tint-text',
  'bg-green-tint text-green-tint-text',
  'bg-violet-tint text-violet-tint-text',
  'bg-red-tint text-red-tint-text',
]

export function tagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

/** Normalize a typed tag: trimmed, collapsed whitespace, capped length. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 24)
}
