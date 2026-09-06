import { tagColor } from '../../utils/tagColor'

export function TagList({ tags }: { tags: string[] | undefined }) {
  if (!tags || tags.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${tagColor(t)}`}>
          {t}
        </span>
      ))}
    </span>
  )
}
