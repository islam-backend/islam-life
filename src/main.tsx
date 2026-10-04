import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import { clearLocalFirebaseConfig, getAppName, loadFirebaseConfig } from './lib/firebase/config'

// import.meta.env.BASE_URL is "/" for dev + Firebase Hosting, "/islam-life/"
// for the GitHub Pages build (see vite.config.ts). React Router needs it
// without the trailing slash.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

const root = createRoot(document.getElementById('root')!)

async function boot() {
  // `?setup` forgets a browser-saved config and reopens the Setup screen —
  // the way out if a wrong project was connected.
  const params = new URLSearchParams(window.location.search)
  if (params.has('setup')) clearLocalFirebaseConfig()

  const config = params.has('setup') ? null : await loadFirebaseConfig()

  // Nothing imports the Firebase SDK until we know which project to use —
  // App (and everything under it) is loaded only after the config resolves.
  if (!config) {
    const { SetupPage } = await import('./pages/SetupPage')
    root.render(
      <StrictMode>
        <SetupPage />
      </StrictMode>
    )
    return
  }

  document.title = getAppName()
  const { default: App } = await import('./App.tsx')
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter basename={basename}>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>
  )
}

void boot()
