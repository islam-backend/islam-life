// Minimal markdown-to-HTML renderer (no external library needed).
export function renderMarkdown(md: string): string {
  const escHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const inlineMd = (html: string) =>
    html
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-field px-1 rounded text-[0.9em]">$1</code>')
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  for (const line of lines) {
    const isList = /^[-*] /.test(line)
    if (isList && !inList) { out.push('<ul class="list-disc pl-5 space-y-0.5">'); inList = true }
    if (!isList && inList) { out.push('</ul>'); inList = false }
    if (line.startsWith('### ')) out.push(`<h3 class="text-[14px] font-bold mt-3">${inlineMd(escHtml(line.slice(4)))}</h3>`)
    else if (line.startsWith('## ')) out.push(`<h2 class="text-[15px] font-bold mt-4">${inlineMd(escHtml(line.slice(3)))}</h2>`)
    else if (line.startsWith('# ')) out.push(`<h1 class="text-[17px] font-bold mt-4">${inlineMd(escHtml(line.slice(2)))}</h1>`)
    else if (isList) out.push(`<li>${inlineMd(escHtml(line.slice(2)))}</li>`)
    else if (line === '') out.push('<div class="h-2"></div>')
    else out.push(`<p>${inlineMd(escHtml(line))}</p>`)
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}
