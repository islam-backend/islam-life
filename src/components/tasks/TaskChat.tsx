import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { useMembers } from '../../hooks/useMembers'
import { useTaskComments } from '../../hooks/useTaskComments'
import { db } from '../../lib/firebase/app'
import { fileToDataUrl, isTextFile, fileToText } from '../../lib/files'
import { fileToChatImage } from '../../lib/image'
import { primeAudio } from '../../lib/notify'
import { canManageClient } from '../../utils/role'
import { Avatar } from '../ui/Avatar'
import { MentionTextInput, nameOf } from './MentionTextInput'
import { MessageText } from './MessageText'

const MAX_FILE_BYTES = 700_000

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

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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
  const canManage = canManageClient(member, clientId)
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

  // Voice recording state
  const [recording, setRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingTimeRef = useRef(0)

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

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      mediaRecorderRef.current?.stop()
    }
  }, [])

  const authorName = member?.displayName || member?.email || 'Member'

  function resolveMentions(body: string): string[] {
    return members
      .filter((m) => mentionUids.includes(m.uid) && body.includes(`@${nameOf(m)}`))
      .map((m) => m.uid)
  }

  function mentionNamesFor(mentions: string[] | undefined): string[] {
    if (!mentions?.length) return []
    return members.filter((m) => mentions.includes(m.uid)).map(nameOf)
  }

  async function postComment(fields: {
    text: string
    imageUrl?: string
    fileUrl?: string
    fileName?: string
    fileType?: string
    audioUrl?: string
    audioDuration?: number
    mentions?: string[]
  }) {
    if (!user) return
    await addDoc(collection(db, 'clients', clientId, 'projects', projectId, 'tasks', taskId, 'comments'), {
      authorUid: user.uid,
      authorEmail: member?.email || user.email || '',
      authorName,
      text: fields.text,
      ...(fields.imageUrl ? { imageUrl: fields.imageUrl } : {}),
      ...(fields.fileUrl ? { fileUrl: fields.fileUrl, fileName: fields.fileName, fileType: fields.fileType } : {}),
      ...(fields.audioUrl ? { audioUrl: fields.audioUrl, ...(fields.audioDuration ? { audioDuration: fields.audioDuration } : {}) } : {}),
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

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    primeAudio()
    setSending(true)
    setError(null)
    const body = text.trim()
    try {
      if (file.type.startsWith('image/')) {
        const imageUrl = await fileToChatImage(file)
        await postComment({ text: body, imageUrl, mentions: resolveMentions(body) })
      } else if (isTextFile(file)) {
        // Store text files as plain content (no base64 overhead)
        if (file.size > MAX_FILE_BYTES) throw new Error('too-large')
        const textContent = await fileToText(file)
        // Encode as a data URL but we'll store it as fileUrl with text MIME
        const fileUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(textContent)}`
        await postComment({ text: body, fileUrl, fileName: file.name, fileType: file.type || 'text/plain', mentions: resolveMentions(body) })
      } else {
        if (file.size > MAX_FILE_BYTES) throw new Error('too-large')
        const fileUrl = await fileToDataUrl(file)
        await postComment({ text: body, fileUrl, fileName: file.name, fileType: file.type, mentions: resolveMentions(body) })
      }
      setText('')
      setMentionUids([])
    } catch (err) {
      setError(
        (err as Error).message === 'too-large'
          ? 'الملف أكبر من 700 كيلوبايت — جرّب ملف أصغر'
          : 'الملف مترفعش — جرّب تاني'
      )
    } finally {
      setSending(false)
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const duration = recordingTimeRef.current
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size > MAX_FILE_BYTES) {
          setError('التسجيل طويل أوي — جرّب أقصر')
          setSending(false)
          return
        }
        const reader = new FileReader()
        reader.onload = async () => {
          const audioUrl = reader.result as string
          try {
            await postComment({ text: '', audioUrl, audioDuration: duration })
          } catch {
            setError('الصوت مترفعش — جرّب تاني')
          } finally {
            setSending(false)
          }
        }
        reader.readAsDataURL(blob)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
      recordingTimeRef.current = 0
      setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => {
        recordingTimeRef.current += 1
        setRecordingTime(recordingTimeRef.current)
        if (recordingTimeRef.current >= 60) stopRecording()
      }, 1000)
    } catch {
      setError('مقدرناش نوصل للميكروفون')
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      setSending(true)
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    setRecording(false)
    setRecordingTime(0)
    recordingTimeRef.current = 0
  }

  function cancelRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (mediaRecorderRef.current) {
      // Detach onstop so it doesn't post
      mediaRecorderRef.current.onstop = null
      if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    setRecording(false)
    setRecordingTime(0)
    recordingTimeRef.current = 0
  }

  function getFileDecoration(fileType = '', fileName = '') {
    if (fileType.startsWith('image/')) return '🖼️'
    if (fileType.startsWith('audio/')) return '🎵'
    if (fileType.includes('pdf')) return '📄'
    if (fileName.endsWith('.md') || fileType.includes('markdown')) return '📝'
    return '📎'
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
                <Avatar
                  name={c.authorName}
                  imageUrl={members.find((m) => m.uid === c.authorUid)?.avatarUrl}
                  size={26}
                  colorClass={mine ? 'bg-avatar-a' : 'bg-avatar-b'}
                />
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
                      {c.audioUrl && (
                        <div className="mb-1.5 flex items-center gap-2">
                          <audio controls src={c.audioUrl} className="h-8 max-w-[220px]" />
                          {c.audioDuration !== undefined && (
                            <span className={`text-[11px] ${mine ? 'text-white/70' : 'text-text-faint'}`}>
                              {formatDuration(c.audioDuration)}
                            </span>
                          )}
                        </div>
                      )}
                      {c.fileUrl && !c.imageUrl && !c.audioUrl && (
                        <a
                          href={c.fileUrl}
                          download={c.fileName || 'file'}
                          onClick={(e) => e.stopPropagation()}
                          className={`mb-1.5 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium ${
                            mine ? 'border-white/20 text-white hover:bg-white/10' : 'border-border text-text-muted hover:bg-field'
                          }`}
                        >
                          <span>{getFileDecoration(c.fileType, c.fileName)}</span>
                          <span className="truncate max-w-[160px]">{c.fileName || 'ملف'}</span>
                        </a>
                      )}
                      {c.text && <MessageText text={c.text} mentionNames={mentionNamesFor(c.mentions)} />}
                    </div>
                  )}

                  {!editing && (mine || canManage) && (
                    <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      {mine && c.text && (
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
                      {canManage && (
                        <button
                          onClick={() => deleteComment(c.id)}
                          className="text-[10.5px] font-medium text-text-faint hover:text-red"
                        >
                          مسح
                        </button>
                      )}
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

      {recording ? (
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-red animate-pulse" />
          <span className="text-[13px] font-medium text-red tabular-nums">{formatDuration(recordingTime)}</span>
          <span className="text-[12px] text-text-faint flex-1">جاري التسجيل…</span>
          <button
            type="button"
            onClick={cancelRecording}
            className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-text-muted hover:border-red hover:text-red"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={stopRecording}
            disabled={sending}
            className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {sending ? '…' : 'إرسال'}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            onChange={handleFile}
            className="hidden"
          />
          <button
            type="button"
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
            title="أرفق ملف أو صورة"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-field text-text-muted hover:text-text disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 9.5l-5 5a3.536 3.536 0 0 1-5-5l6-6a2.357 2.357 0 0 1 3.333 3.333L7.167 12.5A1.179 1.179 0 0 1 5.5 10.833l5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* Voice recording button */}
          {'mediaDevices' in navigator && (
            <button
              type="button"
              disabled={sending}
              onClick={startRecording}
              title="رسالة صوتية"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-field text-text-muted hover:text-text disabled:opacity-60"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="5.5" y="1" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M3 7.5A5 5 0 0 0 13 7.5M8 13v2M6 15h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
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
      )}

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
