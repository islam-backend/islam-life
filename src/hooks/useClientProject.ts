import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'

/**
 * Fetches just ONE client + ONE project directly by id — used to render
 * a project page's breadcrumb fast, without waiting on the full
 * clients→projects tree (that's what the sidebar needs, not this).
 */
export function useClientProject(clientId: string, projectId: string) {
  const [clientName, setClientName] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [clientLoaded, setClientLoaded] = useState(false)
  const [projectLoaded, setProjectLoaded] = useState(false)

  useEffect(() => {
    setClientLoaded(false)
    setProjectLoaded(false)
    setClientName(null)
    setProjectName(null)

    const unsubClient = onSnapshot(
      doc(db, 'clients', clientId),
      (snap) => {
        setClientName(snap.exists() ? (snap.data().name ?? null) : null)
        setClientLoaded(true)
      },
      () => setClientLoaded(true)
    )
    const unsubProject = onSnapshot(
      doc(db, 'clients', clientId, 'projects', projectId),
      (snap) => {
        setProjectName(snap.exists() ? (snap.data().name ?? null) : null)
        setProjectLoaded(true)
      },
      () => setProjectLoaded(true)
    )

    return () => {
      unsubClient()
      unsubProject()
    }
  }, [clientId, projectId])

  const loading = !clientLoaded || !projectLoaded
  const notFound = !loading && (!clientName || !projectName)

  return { clientName, projectName, loading, notFound }
}
