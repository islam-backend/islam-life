import { useState } from 'react'

import { Button } from '../components/ui/Button'
import { type FirebaseWebConfig, parseFirebaseConfig, saveLocalFirebaseConfig } from '../lib/firebase/config'

// Shown by main.tsx when no Firebase config is deployed or saved. Must not
// import anything that touches the Firebase SDK (lib/firebase/app etc.).

const STEPS = [
  <>
    Create a project at <b>console.firebase.google.com</b>.
  </>,
  <>
    <b>Build → Authentication</b> → Get started → enable the <b>Google</b> provider.
  </>,
  <>
    <b>Build → Firestore Database</b> → Create database (production mode). Optional:{' '}
    <b>Build → Storage</b> for profile pictures.
  </>,
  <>
    <b>Project settings → General → Your apps</b> → add a <b>Web app (&lt;/&gt;)</b> and copy its{' '}
    <code>firebaseConfig</code>.
  </>,
  <>Upload or paste it below.</>,
]

function download(config: FirebaseWebConfig) {
  const blob = new Blob([JSON.stringify(config, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'firebase-config.json'
  a.click()
  URL.revokeObjectURL(url)
}

export function SetupPage() {
  const [text, setText] = useState('')
  const [appName, setAppName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<FirebaseWebConfig | null>(null)
  const [dragging, setDragging] = useState(false)

  function check(input: string) {
    setText(input)
    if (!input.trim()) {
      setConfig(null)
      setError(null)
      return
    }
    try {
      const parsed = parseFirebaseConfig(input)
      setConfig(parsed)
      setError(null)
      if (parsed.appName && !appName) setAppName(parsed.appName)
    } catch (e) {
      setConfig(null)
      setError((e as Error).message)
    }
  }

  async function readFile(file: File | undefined) {
    if (file) check(await file.text())
  }

  const finalConfig = config ? { ...config, ...(appName.trim() ? { appName: appName.trim() } : {}) } : null

  function useHere() {
    if (!finalConfig) return
    saveLocalFirebaseConfig(finalConfig)
    window.location.href = import.meta.env.BASE_URL
  }

  return (
    <div className="flex min-h-full items-start justify-center bg-bg px-4 py-12">
      <div className="flex w-full max-w-[620px] flex-col gap-6 rounded-xl border border-border bg-surface p-8">
        <div className="flex flex-col gap-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-accent text-lg">🚀</div>
          <h1 className="mt-2 text-xl font-bold text-text">Connect your Firebase project</h1>
          <p className="text-[13px] leading-relaxed text-text-muted">
            This workspace runs on your own Firebase project — your data stays in your account. One-time setup:
          </p>
        </div>

        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-text-muted">
          {STEPS.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>

        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void readFile(e.dataTransfer.files[0])
          }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center ${
            dragging ? 'border-accent bg-accent-tint' : 'border-border bg-field hover:border-accent'
          }`}
        >
          <span className="text-[13px] font-semibold text-text">Upload firebase-config.json</span>
          <span className="text-[12px] text-text-faint">or drop it here</span>
          <input
            type="file"
            accept=".json,.js,.txt,application/json"
            className="hidden"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </label>

        <textarea
          value={text}
          onChange={(e) => check(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'…or paste it here:\n\nconst firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  appId: "…"\n};'}
          className="resize-y rounded-lg border border-border bg-field px-4 py-3 font-mono text-[12px] leading-relaxed text-text outline-none placeholder:text-text-faint focus:border-accent"
        />

        {error && <p className="text-[12.5px] text-red">{error}</p>}

        {finalConfig && (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-field p-4">
            <p className="text-[13px] text-text">
              ✓ Looks good — project <b>{finalConfig.projectId}</b>
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-text-faint">Workspace name (shown in the app)</span>
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="e.g. Acme Studio"
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] text-text outline-none focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="primary" onClick={useHere}>
                Continue in this browser
              </Button>
              <Button onClick={() => download(finalConfig)}>Download firebase-config.json</Button>
            </div>
            <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-text-muted">
              <p>
                <b>Make it live for the whole team:</b> put the downloaded file in the app's <code>public/</code> folder
                and run <code>npm run setup -- public/firebase-config.json</code>. That deploys the security rules and
                indexes to your project, then build &amp; deploy the app.
              </p>
              <p>
                In Authentication → Settings → <b>Authorized domains</b>, add the domain the app is hosted on.
              </p>
              <p>
                <b>The first person to sign in becomes the workspace owner</b> — sign in yourself before sharing the link.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
