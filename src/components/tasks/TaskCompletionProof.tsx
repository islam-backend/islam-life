import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { type ChangeEvent, type ClipboardEvent, type DragEvent, useEffect, useRef, useState } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { useTaskAttachments } from '../../hooks/useTaskAttachments'
import { db } from '../../lib/firebase/app'
import { fileToProofImage } from '../../lib/image'

function formatStamp(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | null)?.toDate?.()
  return d ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
}

/**
 * "Proof of done" — screenshots showing the task is actually finished.
 * Stored as attachments with kind: 'proof' (same collection + rules as
 * regular files), shown here as a thumbnail grid instead of the file list.
 * Paste (Ctrl+V), drag-drop, or pick a file.
 */
export function TaskCompletionProof({
  clientId,
  projectId,
  taskId,
  isDone,
  canEdit,
  canDelete,
}: {
  clientId: string
  projectId: string
  taskId: string
  isDone: boolean
  canEdit: boolean
  canDelete: boolean
}) {
  const { user, member } = useAuth()
  const { attachments, loading } = useTaskAttachments(clientId, projectId, taskId)
  const proofs = attachments.filter((a) => a.kind === 'proof')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)

  const viewed = proofs.find((p) => p.id === viewing)

  useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])

  async function upload(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!user || images.length === 0) {
      if (files.length > 0) setError('لازم تكون صورة')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const coll = collection(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'attachments')
      for (const file of images) {
        const fileDataUrl = await fileToProofImage(file)
        await addDoc(coll, {
          kind: 'proof',
          fileName: file.name || 'screenshot.jpg',
          fileType: 'image/jpeg',
          fileDataUrl,
          fileSize: file.size,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          createdByName: member?.displayName || member?.email || 'Member',
        })
      }
    } catch (err) {
      setError((err as Error).message === 'too-large' ? 'الصورة كبيرة أوي — جرّب تقصّها' : 'الصورة مترفعتش — جرّب تاني')
    } finally {
      setUploading(false)
    }
  }

  function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    upload(files)
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    upload(files)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    upload(Array.from(e.dataTransfer.files))
  }

  async function handleDelete(id: string) {
    if (!window.confirm('تمسح السكرين شوت دي؟')) return
    try {
      await deleteDoc(doc(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'attachments', id))
      if (viewing === id) setViewing(null)
    } catch {
      setError('المسح منفعش — جرّب تاني')
    }
  }

  const missing = isDone && !loading && proofs.length === 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
          Proof of done {proofs.length > 0 && `· ${proofs.length}`}
          {isDone && proofs.length > 0 && (
            <span className="rounded-full bg-green-tint px-2 py-0.5 text-[10.5px] normal-case tracking-normal text-green-tint-text">
              ✓ متوثّقة
            </span>
          )}
        </span>
      </div>

      {missing && (
        <p className="rounded-lg bg-red-tint px-3 py-2 text-[12.5px] text-red-tint-text">
          التاسك دي Done بس مفيش سكرين شوت بتثبت إنها خلصت.
        </p>
      )}

      {error && <p className="text-[12px] text-red">{error}</p>}

      {proofs.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {proofs.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-lg border border-border bg-field/40">
              <button type="button" onClick={() => setViewing(p.id)} className="block w-full cursor-zoom-in">
                <img src={p.fileDataUrl} alt={p.fileName} className="aspect-video w-full object-cover object-top" />
              </button>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-text-faint">
                <span className="truncate">{p.createdByName}</span>
                <span className="shrink-0">{formatStamp(p.createdAt)}</span>
              </div>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(p.id)}
                  className="absolute right-1.5 top-1.5 rounded-md bg-surface/90 px-1.5 py-0.5 text-[11px] text-text-faint opacity-0 hover:text-red group-hover:opacity-100"
                >
                  مسح
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div
          tabIndex={0}
          onPaste={handlePaste}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`flex cursor-text flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center outline-none focus:border-accent ${
            dragOver ? 'border-accent bg-accent-tint' : 'border-border hover:bg-field/40'
          }`}
        >
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePick} className="hidden" />
          <span className="text-[13px] font-medium text-text-muted">
            {uploading ? 'جاري الرفع…' : 'ضيف سكرين شوت إن التاسك خلصت'}
          </span>
          <span className="text-[11.5px] text-text-faint">
            دوس هنا واعمل Ctrl+V، أو اسحب الصورة، أو{' '}
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="font-medium text-accent hover:underline disabled:opacity-60"
            >
              اختار ملف
            </button>
          </span>
        </div>
      )}

      {viewed && (
        <div
          onClick={() => setViewing(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
        >
          <img src={viewed.fileDataUrl} alt={viewed.fileName} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
