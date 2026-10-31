import { useEffect, useState } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { getAppName } from '../../lib/firebase/config'
import { verifyBiometric } from '../../lib/biometric'

export function BiometricLockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { signOut } = useAuth()
  const [failed, setFailed] = useState(false)
  const [checking, setChecking] = useState(false)

  const attempt = async () => {
    setChecking(true)
    setFailed(false)
    const ok = await verifyBiometric(`Unlock ${getAppName()}`)
    setChecking(false)
    if (ok) onUnlocked()
    else setFailed(true)
  }

  // Prompt automatically as soon as the lock screen appears.
  useEffect(() => {
    void attempt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4">
      <div className="flex w-[380px] flex-col items-center gap-6 rounded-xl border border-border bg-surface p-10 text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-accent text-lg">🔒</div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-bold text-text">{getAppName()}</h1>
          <p className="text-[13px] text-text-muted">Use your fingerprint to unlock.</p>
        </div>

        {failed && (
          <p className="text-[13px] text-red-tint-text">Couldn't verify — try again.</p>
        )}

        <button
          onClick={attempt}
          disabled={checking}
          className="flex w-full items-center justify-center gap-3 rounded-[7px] border border-border bg-field py-2.5 text-[13px] font-semibold text-text hover:bg-surface disabled:opacity-60"
        >
          {checking ? 'Checking…' : 'Unlock'}
        </button>

        <button
          onClick={signOut}
          className="text-[12.5px] font-medium text-text-muted underline hover:text-text"
        >
          Sign out instead
        </button>
      </div>
    </div>
  )
}
