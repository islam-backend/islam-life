import type { Task, TaskStatus } from '../types/task'
import { PRIORITY_META } from '../utils/priority'

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
}

function formatDate(ts: unknown): string | null {
  const d = ts instanceof Date ? ts : (ts as { toDate?: () => Date } | null)?.toDate?.()
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
}

/**
 * A developer/AI brief: one section per task with its metadata and
 * description. `heading` is usually "Client — Project".
 */
export function tasksToMarkdown(tasks: Task[], heading: string): string {
  const lines: string[] = [`# ${heading}`, '', `_${tasks.length} task${tasks.length === 1 ? '' : 's'} · exported ${formatDate(new Date())}_`, '']

  tasks.forEach((t, i) => {
    lines.push(`## ${i + 1}. ${t.title}`, '')
    lines.push(`- **Status:** ${STATUS_LABEL[t.status] ?? t.status}`)
    if (t.priority && PRIORITY_META[t.priority]) lines.push(`- **Priority:** ${PRIORITY_META[t.priority].label}`)
    const start = formatDate(t.startDate)
    const due = formatDate(t.dueDate)
    if (start) lines.push(`- **Start:** ${start}`)
    if (due) lines.push(`- **Due:** ${due}`)
    const people = (t.assignees ?? []).map((a) => a.displayName || a.email)
    lines.push(`- **Assignees:** ${people.length ? people.join(', ') : 'Unassigned'}`)
    if (t.tags?.length) lines.push(`- **Tags:** ${t.tags.join(', ')}`)
    lines.push('', '### Description', '', t.description?.trim() || '_No description._', '')
  })

  return lines.join('\n')
}

/**
 * Same brief wrapped in instructions, meant to be pasted into a free chat
 * AI (Claude.ai / ChatGPT) that turns it into a polished task brief.
 */
export function tasksToAiPrompt(tasks: Task[], heading: string): string {
  return `You are helping me write a clear task brief in Markdown.

Below are ${tasks.length} task(s) exported from my task manager (project: ${heading}).
Rewrite them into ONE well-structured Markdown file:

1. Start with a short "Overview" section summarising what these tasks achieve together.
2. Then one section per task with: a clear title, the goal, the context/details from the description, acceptance criteria (a checklist of what "done" means), and the metadata (status, priority, due date, assignees, tags).
3. Group or order the tasks sensibly (e.g. by dependency or priority) and note any dependencies between them.
4. End with an "Open questions" section listing anything unclear or missing.

Rules:
- Only use facts from the tasks below — do not invent requirements. If something is missing, put it under "Open questions".
- Keep the same language the tasks are written in (Arabic stays Arabic, English stays English).
- Reply with the Markdown file only, inside a single \`\`\`markdown code block.

---

${tasksToMarkdown(tasks, heading)}`
}

/** Safe-ish filename from a heading: "Acme — Website" → "acme-website-tasks.md" */
export function markdownFileName(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'tasks'}-tasks.md`
}

export function downloadMarkdown(content: string, fileName: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
