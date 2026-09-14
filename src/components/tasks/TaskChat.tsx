import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'

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
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── WhatsApp-style voice message player ─────────────────────────────────────

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 3.5l8 4.5-8 4.5V3.5z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="2" width="3.5" height="12" rx="1" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
    </svg>
  )
}

/** Seeded pseudo-random bar heights — stable per message. */
function makeWaveBars(seed: string, count = 32): number[] {
  let n = seed.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x811c9dc5)
  return Array.from({ length: count }, () => {
    n = Math.imul(n ^ (n >>> 17), 0x45d9f3b)
    n = Math.imul(n ^ (n >>> 13), 0x3f7f4c3d)
    n ^= n >>> 16
    return 20 + Math.abs(n % 72)
  })
}

function VoiceMessage({
  audioUrl,
  audioDuration,
  mine,
}: {
  audioUrl: string
  audioDuration?: number
  mine: boolean
}) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const bars = useMemo(() => makeWaveBars(audioUrl), [audioUrl])
  const totalSecs = audioDuration ?? 0
  const progress = totalSecs > 0 ? currentTime / totalSecs : 0
  const playedCount = Math.floor(progress * bars.length)

  function toggle() {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl)
      audioRef.current.ontimeupdate = () => setCurrentTime(audioRef.current?.currentTime ?? 0)
      audioRef.current.onended = () => {
        setPlaying(false)
        setCurrentTime(0)
      }
    }
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      void audioRef.current.play()
      setPlaying(true)
    }
  }

  useEffect(() => {
    const a = audioRef.current
    return () => { a?.pause() }
  }, [])

  const accentColor = mine ? 'bg-white' : 'bg-accent'
  const dimColor = mine ? 'bg-white/35' : 'bg-border'
  const btnBg = mine ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-accent/10 hover:bg-accent/20 text-accent'

  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <button
        onClick={toggle}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${btnBg}`}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* Waveform bars */}
      <div className="flex flex-1 items-center gap-[2.5px]" style={{ height: 28 }}>
        {bars.map((h, i) => (
          <div
            key={i}
            className={`w-[3px] rounded-full transition-colors duration-75 ${i < playedCount ? accentColor : dimColor}`}
            style={{ height: `${Math.min(h, 100)}%` }}
          />
        ))}
      </div>

      <span className={`shrink-0 text-[11px] tabular-nums ${mine ? 'text-white/70' : 'text-text-faint'}`}>
        {formatDuration(playing ? currentTime : totalSecs)}
      </span>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

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
      ...(fields.audioUrl
        ? { audioUrl: fields.audioUrl, ...(fields.audioDuration ? { audioDuration: fields.audioDuration } : {}) }
        : {}),
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
        if (file.size > MAX_FILE_BYTES) throw new Error('too-large')
        const textContent = await fileToText(file)
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
          try {
            await postComment({ text: '', audioUrl: reader.result as string, audioDuration: duration })
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
                        <VoiceMessage audioUrl={c.audioUrl} audioDuration={c.audioDuration} mine={mine} />
                      )}
                      {c.fileUrl && !c.imageUrl && !c.audioUrl && (
                        <a
                          href={c.fileUrl}
                          download={c.fileName || 'file'}
                          onClick={(e) => e.stopPropagation()}
                          className={`mb-1.5 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium ${
                            mine
                              ? 'border-white/20 text-white hover:bg-white/10'
                              : 'border-border text-text-muted hover:bg-field'
                          }`}
                        >
                          <span>{getFileDecoration(c.fileType, c.fileName)}</span>
                          <span className="max-w-[160px] truncate">{c.fileName || 'ملف'}</span>
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

      {/* ── Recording bar ── */}
      {recording ? (
        <div className="flex items-center gap-3 rounded-xl border border-red/30 bg-red/5 px-3 py-2">
          {/* Pulsing dot */}
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red" />
          </span>

          {/* Timer */}
          <span className="w-10 shrink-0 text-[13px] font-semibold tabular-nums text-red">
            {formatDuration(recordingTime)}
          </span>

          {/* Animated waveform bars */}
          <div className="flex flex-1 items-center justify-center gap-[3px]" style={{ height: 24 }}>
            {Array.from({ length: 20 }, (_, i) => (
              <div
                key={i}
                className="w-[3px] rounded-full bg-red/50"
                style={{
                  height: '100%',
                  animation: `pulse-bar ${0.4 + (i % 5) * 0.1}s ease-in-out infinite alternate`,
                  animationDelay: `${(i * 37) % 200}ms`,
                }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={cancelRecording}
            title="إلغاء"
            className="shrink-0 rounded-lg p-1.5 text-text-faint hover:bg-surface hover:text-red"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={stopRecording}
            disabled={sending}
            title="إرسال"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm disabled:opacity-50"
          >
            {sending ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="animate-spin">
                <path d="M8 1a7 7 0 1 0 7 7" strokeWidth="0" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 8l10-6-3 6 3 6L2 8z" />
              </svg>
            )}
          </button>
        </div>
      ) : (
        /* ── Normal input bar ── */
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="*/*" onChange={handleFile} className="hidden" />

          {/* File attach */}
          <button
            type="button"
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
            title="أرفق ملف أو صورة"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-field text-text-muted hover:text-text disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.5 9.5l-5 5a3.536 3.536 0 0 1-5-5l6-6a2.357 2.357 0 0 1 3.333 3.333L7.167 12.5A1.179 1.179 0 0 1 5.5 10.833l5-5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Mic */}
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
                <path
                  d="M3 7.5A5 5 0 0 0 13 7.5M8 13v2M6 15h4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
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

      {/* Image zoom overlay */}
      {zoomed && (
        <div
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
        >
          <img src={zoomed} alt="attachment" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}

      {/* Keyframes for the recording bar's animated bars */}
      <style>{`
        @keyframes pulse-bar {
          from { transform: scaleY(0.25); }
          to   { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}
