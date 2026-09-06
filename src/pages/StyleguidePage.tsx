import type { ReactNode } from 'react'

import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { FormField } from '../components/ui/FormField'
import { StatusPill } from '../components/ui/StatusPill'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{title}</h2>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-5">
        {children}
      </div>
    </section>
  )
}

/**
 * Owner-only living reference for the app's UI primitives — renders the
 * real components, so it can never silently drift from the code. See
 * STYLEGUIDE.md for the token table and component conventions.
 */
export function StyleguidePage() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-8 overflow-y-auto p-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold text-text">Design System</h1>
        <p className="text-[13px] text-text-muted">Slate palette · every screen in the app is built from these.</p>
        <p className="text-[12px] text-text-faint">
          A reference, not a settings page — it just shows the real building blocks so any new feature reuses them
          instead of inventing new styles. Nothing here is editable; components are changed in the code.
        </p>
      </div>

      <Section title="Buttons">
        <Button variant="primary">New Task</Button>
        <Button variant="secondary">Invite teammate</Button>
        <Button variant="ghost">Cancel</Button>
      </Section>

      <Section title="Status pills">
        <StatusPill status="backlog" />
        <StatusPill status="todo" />
        <StatusPill status="in_progress" />
        <StatusPill status="done" />
      </Section>

      <Section title="Avatars">
        <Avatar name="Sara" colorClass="bg-avatar-a" />
        <Avatar name="Omar" colorClass="bg-avatar-b" />
        <Avatar name="Client A" colorClass="bg-accent" statusBorder="green" />
        <Avatar name="Client B" colorClass="bg-accent" statusBorder="amber" />
        <Avatar name="Client C" colorClass="bg-accent" statusBorder="red" />
      </Section>

      <Section title="Form field">
        <div className="w-64">
          <FormField label="Display name">
            <input
              className="w-full rounded-[8px] border border-border bg-field px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
              defaultValue="Omar"
            />
          </FormField>
        </div>
      </Section>

      <Section title="Palette">
        {/*
          Inline styles here are deliberate: this grid renders the RAW
          tokens.css variables for reference. Everywhere else in the app,
          use the Tailwind utilities (bg-accent, text-text-muted, ...)
          mapped in src/index.css — never a raw var() in a component.
        */}
        {[
          ['--bg', 'Background'],
          ['--sidebar-bg', 'Sidebar'],
          ['--surface', 'Surface'],
          ['--field-bg', 'Field'],
          ['--accent', 'Accent'],
          ['--violet', 'Violet'],
          ['--amber', 'Amber'],
          ['--green', 'Green'],
          ['--red', 'Red'],
        ].map(([token, label]) => (
          <div key={token} className="flex flex-col items-center gap-1.5">
            <div
              className="h-10 w-10 rounded-md border border-border"
              style={{ background: `var(${token})` }}
            />
            <span className="text-[11px] text-text-faint">{label}</span>
          </div>
        ))}
      </Section>
    </div>
  )
}
