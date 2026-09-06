import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { useTaskComments } from '../../hooks/useTaskComments'
import { db } from '../../lib/firebase/app'
import { fileToChatImage } from '../../lib/image'
import { primeAudio } from '../../lib/notify'
import { Avatar } from '../ui/Avatar'

function formatTime(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | null)?.toDate?.()
  if (!d) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function TaskChat({
  clientId,
  projectId,
  taskId,
}: {
  clientId: string
  projectId: string
  taskId: string
}) {
  const { user, member } = useAuth()
  const { comments, loading } = useTaskComments(clientId, projectId, taskId)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [comments.length])

  const authorName = member?.displayName || member?.email || 'Member'

  async function postComment(fields: { text: string; imageUrl?: string }) {
    if (!user) return
    await addDoc(collection(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'comments'), {
      authorUid: user.uid,
      authorEmail: member?.email || user.email || '',
      authorName,
      text: fields.text,
      ...(fields.imageUrl ? { imageUrl: fields.imageUrl } : {}),
      createdAt: serverTimestamp(),
    })
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending || !user) return
    primeAudio()
    setSending(true)
    setError(null)
    try {
      await postComment({ text: trimmed })
      setText('')
    } catch {
      setError('الرسالة مبعتتش — جرّب تاني')
    } finally {
      setSending(false)
    }
  }

  async function handleImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    primeAudio()
    setSending(true)
    setError(null)
    try {
      const imageUrl = await fileToChatImage(file)
      await postComment({ text: text.trim(), imageUrl })
      setText('')
    } catch (err) {
      setError(
        (err as Error).message === 'too-large'
          ? 'الصورة كبيرة أوي حتى بعد الضغط — جرّب صورة أصغر'
          : 'الصورة مترفعتش — جرّب تاني'
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">
        Chat {comments.length > 0 && `· ${comments.length}`}
      </span>

      <div className="flex max-h-[440px] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-field/40 p-4">
        {loading ? (
          <p className="text-[12.5px] text-text-faint">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">مفيش رسائل لسه — ابدأ الكلام.</p>
        ) : (
          comments.map((c) => {
            const mine = c.authorUid === user?.uid
            return (
              <div key={c.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                <Avatar name={c.authorName} size={26} colorClass={mine ? 'bg-avatar-a' : 'bg-avatar-b'} />
                <div className={`flex max-w-[78%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                  <span className="text-[11px] text-text-faint">
                    {mine ? 'أنا' : c.authorName} · {formatTime(c.createdAt)}
                  </span>
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                      mine ? 'bg-accent text-white' : 'bg-surface text-text'
                    }`}
                  >
                    {c.imageUrl && (
                      <img
                        src={c.imageUrl}
                        alt="attachment"
                        onClick={() => setZoomed(c.imageUrl!)}
                        className="mb-1.5 max-h-60 cursor-zoom-in rounded-lg object-cover"
                      />
                    )}
                    {c.text && <span className="whitespace-pre-wrap break-words">{c.text}</span>}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="text-[12px] text-red">{error}</p>}

      <form onSubmit={handleSend} className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImage}
          className="hidden"
        />
        <button
          type="button"
          disabled={sending}
          onClick={() => fileInputRef.current?.click()}
          title="أرفق صورة"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-field text-text-muted hover:text-text disabled:opacity-60"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="5.5" cy="6.5" r="1.1" fill="currentColor" />
            <path d="M3 12l3.5-3.5 2 2L11 7l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="اكتب رسالة…"
          className="flex-1 rounded-lg border border-border bg-field px-3.5 py-2 text-[13px] text-text outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {sending ? '…' : 'إرسال'}
        </button>
      </form>

      {zoomed && (
        <div
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
        >
          <img src={zoomed} alt="attachment" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}
