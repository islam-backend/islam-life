import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ProjectTabs } from '../components/layout/ProjectTabs'
import { TopBar } from '../components/layout/TopBar'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useAuth } from '../hooks/useAuth'
import { useClientProject } from '../hooks/useClientProject'
import { useProjectNotes } from '../hooks/useProjectNotes'
import { db } from '../lib/firebase/app'
import { renderMarkdown } from '../lib/markdown'
import type { NoteSection, ProjectNote } from '../types/note'
import { NOTE_SECTIONS, sectionMeta } from '../utils/noteSection'
import { canManageClient } from '../utils/role'

function formatStamp(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | null)?.toDate?.()
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

function snippet(md: string): string {
  return md.replace(/[#*`>-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)
}

export function ProjectNotesPage() {
  const { clientId = '', projectId = '' } = useParams()
  const { member } = useAuth()
  const canManage = canManageClient(member, clientId)
  const direct = useClientProject(clientId, projectId)
  const { notes, loading } = useProjectNotes(clientId, projectId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<NoteSection | 'all'>('all')
  const [creating, setCreating] = useState(false)

  const visible = useMemo(() => {
    const list = filter === 'all' ? notes : notes.filter((n) => n.section === filter)
    // Pinned first; the query already orders newest-first within each group.
    return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
  }, [notes, filter])

  // Falls back to the first note until one is picked, or after it's deleted.
  const selected = notes.find((n) => n.id === selectedId) ?? visible[0] ?? null

  if (direct.notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-[13px] text-text-muted">This project doesn't exist (or you don't have access to it).</p>
        <Link to="/" className="text-[12.5px] font-medium text-accent hover:underline">
          Back home
        </Link>
      </div>
    )
  }
  if (!direct.clientName || !direct.projectName) {
    return <div className="flex flex-1 items-center justify-center text-[13px] text-text-faint">Loading…</div>
  }

  async function createNote() {
    if (!member) return
    setCreating(true)
    try {
      const ref = await addDoc(collection(db, 'clients', clientId, 'projects', projectId, 'notes'), {
        title: 'نوت جديدة',
        content: '',
        section: filter === 'all' ? 'overview' : filter,
        pinned: false,
        createdAt: serverTimestamp(),
        createdBy: member.uid,
        createdByName: member.displayName || member.email,
        updatedAt: serverTimestamp(),
        updatedByName: member.displayName || member.email,
      })
      setSelectedId(ref.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <TopBar
        crumbs={[
          { label: direct.clientName },
          { label: direct.projectName, to: `/clients/${clientId}/projects/${projectId}` },
          { label: 'Notes' },
        ]}
        actions={
          <Button variant="primary" onClick={createNote} disabled={creating}>
            New Note
          </Button>
        }
      />
      <ProjectTabs clientId={clientId} projectId={projectId} noteCount={notes.length} />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              الكل
            </FilterChip>
            {NOTE_SECTIONS.map((s) => (
              <FilterChip key={s.value} active={filter === s.value} onClick={() => setFilter(s.value)}>
                <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <p className="p-3 text-[12.5px] text-text-faint">Loading…</p>
            ) : visible.length === 0 ? (
              <p className="p-3 text-[12.5px] text-text-faint">
                مفيش نوتس هنا لسه. دوس New Note وابدأ.
              </p>
            ) : (
              visible.map((n) => {
                const meta = sectionMeta(n.section)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setSelectedId(n.id)}
                    className={`mb-1 flex w-full cursor-pointer flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      n.id === selected?.id ? 'bg-field' : 'hover:bg-field/60'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                      <span dir="auto" className="truncate text-[13px] font-semibold text-text">
                        {n.title || 'من غير عنوان'}
                      </span>
                      {n.pinned && <span className="ml-auto text-[11px]">📌</span>}
                    </span>
                    <span dir="auto" className="line-clamp-2 text-[12px] leading-snug text-text-faint">
                      {snippet(n.content) || 'فاضية'}
                    </span>
                    <span className="text-[10.5px] text-text-faint">{formatStamp(n.updatedAt ?? n.createdAt)}</span>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <NoteEditor
              // Remount per note so drafts never leak between notes.
              key={selected.id}
              note={selected}
              clientId={clientId}
              projectId={projectId}
              canManage={canManage}
              canEdit={canManage || selected.createdBy === member?.uid}
              authorName={member?.displayName || member?.email || 'Member'}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-text-faint">
              اختار نوت أو اعمل واحدة جديدة
            </div>
          )}
        </main>
      </div>
    </>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
        active ? 'bg-accent-tint text-accent-tint-text' : 'text-text-faint hover:bg-field hover:text-text-muted'
      }`}
    >
      {children}
    </button>
  )
}

function NoteEditor({
  note,
  clientId,
  projectId,
  canManage,
  canEdit,
  authorName,
  onDeleted,
}: {
  note: ProjectNote
  clientId: string
  projectId: string
  /** Owner / managing manager — may also pin. */
  canManage: boolean
  /** Manager, or the member who wrote this note. */
  canEdit: boolean
  authorName: string
  onDeleted: () => void
}) {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [preview, setPreview] = useState(!canEdit)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = doc(db, 'clients', clientId, 'projects', projectId, 'notes', note.id)

  async function patch(fields: Partial<ProjectNote>) {
    setError(null)
    try {
      await updateDoc(ref, { ...fields, updatedAt: serverTimestamp(), updatedByName: authorName })
    } catch {
      setError('الحفظ منفعش — جرّب تاني')
    }
  }

  const saveTitle = () => {
    const t = title.trim() || 'من غير عنوان'
    setTitle(t)
    if (t !== note.title) void patch({ title: t })
  }
  const saveContent = () => {
    if (content !== note.content) void patch({ content })
  }

  const meta = sectionMeta(note.section)

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 p-8">
      <div className="flex items-start justify-between gap-3">
        {canEdit ? (
          <input
            dir="auto"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Note title"
            className="-mx-2 min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-2xl font-bold text-text outline-none hover:bg-field/60 focus:bg-field focus:ring-1 focus:ring-accent"
          />
        ) : (
          <h1 dir="auto" className="text-2xl font-bold text-text">
            {note.title}
          </h1>
        )}
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            {canManage && (
              <button
                type="button"
                title={note.pinned ? 'Unpin' : 'Pin'}
                onClick={() => patch({ pinned: !note.pinned })}
                className={`cursor-pointer rounded-md px-2 py-1 text-[13px] hover:bg-field ${note.pinned ? '' : 'opacity-40 hover:opacity-100'}`}
              >
                📌
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="cursor-pointer rounded-md px-2 py-1 text-[12px] text-text-faint hover:bg-field hover:text-red"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          NOTE_SECTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => patch({ section: s.value })}
              className={`cursor-pointer rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-opacity ${s.chip} ${
                note.section === s.value ? '' : 'opacity-40 hover:opacity-80'
              }`}
            >
              {s.label}
            </button>
          ))
        ) : (
          <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${meta.chip}`}>{meta.label}</span>
        )}
        <span className="ml-auto text-[11.5px] text-text-faint">
          {note.createdByName ? `${note.createdByName} · ` : ''}
          {note.updatedByName && note.updatedAt ? `آخر تعديل ${formatStamp(note.updatedAt)} بواسطة ${note.updatedByName}` : formatStamp(note.createdAt)}
        </span>
      </div>

      {canEdit && (
        <div className="flex w-fit gap-0.5 rounded-lg bg-field p-0.5 text-[12px] font-medium">
          {[
            { id: false, label: 'Write' },
            { id: true, label: 'Preview' },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                if (t.id) saveContent()
                setPreview(t.id)
              }}
              className={`cursor-pointer rounded-md px-3 py-1 ${preview === t.id ? 'bg-surface text-text' : 'text-text-faint hover:text-text-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {preview ? (
        content.trim() ? (
          <div
            dir="auto"
            className="text-[13.5px] leading-relaxed text-text"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        ) : (
          <p className="text-[13px] text-text-faint">النوت فاضية.</p>
        )
      ) : (
        <textarea
          dir="auto"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={saveContent}
          rows={18}
          placeholder={'اكتب التفاصيل هنا…\n\nبيدعم: # عنوان · **bold** · - قايمة · `code`'}
          className="min-h-[320px] resize-y rounded-lg border border-border bg-field px-4 py-3 text-[13.5px] leading-relaxed text-text outline-none placeholder:text-text-faint focus:ring-1 focus:ring-accent"
        />
      )}

      {error && <p className="text-[12px] text-red">{error}</p>}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        message={`"${note.title}" will be gone for good.`}
        confirmLabel="Delete note"
        onConfirm={async () => {
          await deleteDoc(ref)
          onDeleted()
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
