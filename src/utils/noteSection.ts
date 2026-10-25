import type { NoteSection } from '../types/note'

export const NOTE_SECTIONS: { value: NoteSection; label: string; chip: string; dot: string }[] = [
  { value: 'overview', label: 'نظرة عامة', chip: 'bg-accent-tint text-accent-tint-text', dot: 'bg-accent' },
  { value: 'requirements', label: 'المتطلبات', chip: 'bg-amber-tint text-amber-tint-text', dot: 'bg-amber' },
  { value: 'decisions', label: 'قرارات', chip: 'bg-green-tint text-green-tint-text', dot: 'bg-green' },
  { value: 'meeting', label: 'اجتماع', chip: 'bg-violet-tint text-violet-tint-text', dot: 'bg-violet' },
  { value: 'links', label: 'روابط', chip: 'bg-cyan-tint text-cyan-tint-text', dot: 'bg-cyan' },
  { value: 'other', label: 'تانية', chip: 'bg-field text-text-muted', dot: 'bg-text-faint' },
]

export function sectionMeta(section: NoteSection | undefined) {
  return NOTE_SECTIONS.find((s) => s.value === section) ?? NOTE_SECTIONS[NOTE_SECTIONS.length - 1]
}
