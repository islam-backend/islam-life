import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { useMembers } from '../../hooks/useMembers'
import { useTaskComments } from '../../hooks/useTaskComments'
import { db } from '../../lib/firebase/app'
import { fileToChatImage } from '../../lib/image'
import { primeAudio } from '../../lib/notify'
import { isOwnerRole } from '../../utils/role'
import { Avatar } from '../ui/Avatar'
import { MentionTextInput, nameOf } from './MentionTextInput'
import { MessageText } from './MessageText'

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
  const { members } = useMembers()
  const isOwner = isOwnerRole(member?.role)
  const { comments, loading } = useTaskComments(clientId, projectId, taskId)
  const [text, setText] = useState('')
  const [mentionUids, setMentionUids] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  function commentRef(id: string) {
    return doc(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'comments', id)
  }

  async function deleteComment(id: string) {
    if (!window.confirm('تمسح الرسالة دي؟')) return
    try {
      await deleteDoc(commentRef(id))
    } catch {
      setError('المسح منفعش — جرّب تاني')
    }
  }

  async function saveEdit(id: string) {
    const trimmed = editText.trim()
    setEditingId(null)
    if (!trimmed) return
    try {
      await updateDoc(commentRef(id), { text: trimmed, editedAt: serverTimestamp() })
    } catch {
      setError('التعديل منفعش — جرّب تاني')
    }
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [comments.length])

  const authorName = member?.displayName || member?.email || 'Member'

  /** uids that were @-picked AND whose name still appears in the text. */
  function resolveMentions(body: string): string[] {
    return members
      .filter((m) => mentionUids.includes(m.uid) && body.includes(`@${nameOf(m)}`))
      .map((m) => m.uid)
  }

  function mentionNamesFor(mentions: string[] | undefined): string[] {
    if (!mentions?.length) return []
    return members.filter((m) => mentions.includes(m.uid)).map(nameOf)
  }

  async function postComment(fields: { text: string; imageUrl?: string; mentions?: string[] }) {
    if (!user) return
    await addDoc(collection(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'comments'), {
      authorUid: user.uid,
      authorEmail: member?.email || user.email || '',
      authorName,
      text: fields.text,
      ...(fields.imageUrl ? { imageUrl: fields.imageUrl } : {}),
      ...(fields.mentions?.length ? { mentions: fields.mentions } : {}),
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
      await postComment({ text: trimmed, mentions: resolveMentions(trimmed) })
      setText('')
      setMentionUids([])
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
      const body = text.trim()
      await postComment({ text: body, imageUrl, mentions: resolveMentions(body) })
      setText('')
      setMentionUids([])
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
            const editing = editingId === c.id
            return (
              <div key={c.id} className={`group flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                <Avatar name={c.authorName} size={26} colorClass={mine ? 'bg-avatar-a' : 'bg-avatar-b'} />
                <div className={`flex max-w-[78%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                  <span className="text-[11px] text-text-faint">
                    {mine ? 'أنا' : c.authorName} · {formatTime(c.createdAt)}
                    {c.editedAt ? ' · اتعدّلت' : ''}
                  </span>

                  {editing ? (
                    <div className="flex w-full flex-col gap-1.5">
                      <textarea
                        dir="auto"
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        className="w-full resize-none rounded-lg border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(c.id)}
                          className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white"
                        >
                          حفظ
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-text-muted"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
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
                      {c.text && <MessageText text={c.text} mentionNames={mentionNamesFor(c.mentions)} />}
                    </div>
                  )}

                  {isOwner && !editing && (
                    <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {c.text && (
                        <button
                          onClick={() => {
                            setEditingId(c.id)
                            setEditText(c.text)
                          }}
                          className="text-[10.5px] font-medium text-text-faint hover:text-text"
                        >
                          تعديل
                        </button>
                      )}
                      <button
                        onClick={() => deleteComment(c.id)}
                        className="text-[10.5px] font-medium text-text-faint hover:text-red"
                      >
                        مسح
                      </button>
                    </div>
                  )}
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
        <MentionTextInput
          value={text}
          onChange={(v, addedUid) => {
            setText(v)
            if (addedUid) setMentionUids((prev) => (prev.includes(addedUid) ? prev : [...prev, addedUid]))
          }}
          members={members}
          disabled={sending}
          placeholder="اكتب رسالة… (@ لمنشن حد)"
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
