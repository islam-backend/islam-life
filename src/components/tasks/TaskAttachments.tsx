import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { type ChangeEvent, useRef, useState } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { useTaskAttachments } from '../../hooks/useTaskAttachments'
import { db } from '../../lib/firebase/app'
import { fileToDataUrl, fileToText, isTextFile } from '../../lib/files'
import { fileToChatImage } from '../../lib/image'

const MAX_FILE_BYTES = 700_000

// Minimal markdown-to-HTML renderer (no external library needed).
function renderMarkdown(md: string): string {
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

function fileIcon(fileType: string, fileName: string): string {
  if (fileType.startsWith('image/')) return '🖼️'
  if (fileType.startsWith('audio/')) return '🎵'
  if (fileType.includes('pdf')) return '📄'
  if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) return '📝'
  if (fileName.endsWith('.json') || fileName.endsWith('.yaml') || fileName.endsWith('.yml')) return '🗂️'
  return '📎'
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5V13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TaskAttachments({
  clientId,
  projectId,
  taskId,
  canEdit,
  canDelete,
}: {
  clientId: string
  projectId: string
  taskId: string
  canEdit: boolean
  canDelete: boolean
}) {
  const { user, member } = useAuth()
  const { attachments, loading } = useTaskAttachments(clientId, projectId, taskId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const authorName = member?.displayName || member?.email || 'Member'

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    setUploading(true)
    setError(null)
    try {
      const coll = collection(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'attachments')
      if (file.type.startsWith('image/')) {
        const fileDataUrl = await fileToChatImage(file)
        await addDoc(coll, {
          fileName: file.name,
          fileType: file.type,
          fileDataUrl,
          fileSize: file.size,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          createdByName: authorName,
        })
      } else if (isTextFile(file)) {
        if (file.size > MAX_FILE_BYTES) throw new Error('too-large')
        const textContent = await fileToText(file)
        await addDoc(coll, {
          fileName: file.name,
          fileType: file.type || 'text/plain',
          textContent,
          fileSize: file.size,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          createdByName: authorName,
        })
      } else {
        if (file.size > MAX_FILE_BYTES) throw new Error('too-large')
        const fileDataUrl = await fileToDataUrl(file)
        await addDoc(coll, {
          fileName: file.name,
          fileType: file.type,
          fileDataUrl,
          fileSize: file.size,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          createdByName: authorName,
        })
      }
    } catch (err) {
      setError((err as Error).message === 'too-large' ? 'الملف أكبر من 700 كيلوبايت' : 'الملف مترفعش — جرّب تاني')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('تمسح الملف ده؟')) return
    try {
      await deleteDoc(doc(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'attachments', id))
    } catch {
      setError('المسح منفعش — جرّب تاني')
    }
  }

  const isMdFile = (name: string) => name.endsWith('.md') || name.endsWith('.markdown')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
          Files {attachments.length > 0 && `· ${attachments.length}`}
        </span>
        {canEdit && (
          <>
            <input ref={fileInputRef} type="file" accept="*/*" onChange={handleUpload} className="hidden" />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-text-faint hover:bg-field hover:text-text disabled:opacity-60"
            >
              <PlusIcon />
              {uploading ? 'جاري الرفع…' : 'رفع ملف'}
            </button>
          </>
        )}
      </div>

      {error && <p className="text-[12px] text-red">{error}</p>}

      {loading ? (
        <p className="text-[12.5px] text-text-faint">Loading…</p>
      ) : attachments.length === 0 ? (
        <p className="text-[12.5px] text-text-faint">مفيش ملفات متحطة لسه.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {attachments.map((a) => {
            const isExpanded = expandedId === a.id
            const canExpand = !!a.textContent || (!!a.fileDataUrl && a.fileType.startsWith('image/'))
            return (
              <div key={a.id} className="rounded-lg border border-border bg-field/40">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="text-base">{fileIcon(a.fileType, a.fileName)}</span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium text-text">{a.fileName}</span>
                    <span className="text-[11px] text-text-faint">{formatFileSize(a.fileSize)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canExpand && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : a.id)}
                        className="rounded px-2 py-1 text-[11.5px] text-text-faint hover:bg-surface hover:text-text"
                      >
                        {isExpanded ? 'إخفاء' : 'عرض'}
                      </button>
                    )}
                    {a.fileDataUrl && !a.fileType.startsWith('image/') && (
                      <a
                        href={a.fileDataUrl}
                        download={a.fileName}
                        className="rounded px-2 py-1 text-[11.5px] text-text-faint hover:bg-surface hover:text-text"
                      >
                        تحميل
                      </a>
                    )}
                    {a.textContent && (
                      <a
                        href={`data:text/plain;charset=utf-8,${encodeURIComponent(a.textContent)}`}
                        download={a.fileName}
                        className="rounded px-2 py-1 text-[11.5px] text-text-faint hover:bg-surface hover:text-text"
                      >
                        تحميل
                      </a>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        className="rounded p-1 text-text-faint hover:bg-surface hover:text-red"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border p-3">
                    {a.fileDataUrl && a.fileType.startsWith('image/') && (
                      <img src={a.fileDataUrl} alt={a.fileName} className="max-h-96 max-w-full rounded object-contain" />
                    )}
                    {a.textContent && isMdFile(a.fileName) && (
                      <div
                        className="prose prose-sm max-w-none text-[13px] text-text leading-relaxed"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(a.textContent) }}
                      />
                    )}
                    {a.textContent && !isMdFile(a.fileName) && (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-surface p-3 text-[12px] text-text-muted">
                        {a.textContent}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
