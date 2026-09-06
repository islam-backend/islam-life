import { useState } from 'react'

/** The invite system is an allowlist — adding an email doesn't send the
 * person anything. This card gives the owner a ready-made link + message
 * to send them by hand (WhatsApp, email, wherever). */
export function InviteShareCard({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const message =
    `اتضافت لفريق العمل على islam-life ✅\n` +
    `افتح اللينك ده وسجّل دخول بحساب Google بتاع الإيميل: ${email}\n` +
    `${origin}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the text is visible below anyway */
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-accent/40 bg-accent-tint/40 p-3.5">
      <p className="text-[12px] font-semibold text-text">
        الدعوة مش بتتبعت تلقائياً — ابعت الرسالة دي لـ {email}:
      </p>
      <pre className="whitespace-pre-wrap rounded-md border border-border bg-field px-3 py-2 text-[12px] leading-relaxed text-text-muted">
        {message}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={copy}
          className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white"
        >
          {copied ? 'اتنسخت ✓' : 'انسخ الرسالة'}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="cursor-pointer rounded-md border border-border bg-field px-3 py-1.5 text-[12px] font-semibold text-text-muted hover:text-text"
        >
          واتساب
        </a>
      </div>
    </div>
  )
}
