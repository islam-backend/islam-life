import { useAuth } from '../hooks/useAuth'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  )
}

export function LoginPage() {
  const { signInWithGoogle, notInvited, signOut } = useAuth()

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4">
      <div className="flex w-[380px] flex-col items-center gap-6 rounded-xl border border-border bg-surface p-10 text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-accent text-lg">🚀</div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-bold text-text">islam-life</h1>
          <p className="text-[13px] text-text-muted">Clients, projects and tasks — one place for the team.</p>
        </div>

        {notInvited ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-[13px] text-red-tint-text">
              This Google account isn't on the team's invite list yet. Ask the workspace owner to add you.
            </p>
            <button
              onClick={signOut}
              className="text-[12.5px] font-medium text-text-muted underline hover:text-text"
            >
              Try a different account
            </button>
          </div>
        ) : (
          <button
            onClick={signInWithGoogle}
            className="flex w-full items-center justify-center gap-3 rounded-[7px] border border-border bg-field py-2.5 text-[13px] font-semibold text-text hover:bg-surface"
          >
            <GoogleIcon />
            Sign in with Google
          </button>
        )}

        <p className="text-[11.5px] text-text-faint">Invite-only workspace &middot; owner + team access only</p>
      </div>
    </div>
  )
}
