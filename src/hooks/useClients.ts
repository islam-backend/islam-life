import { collection, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { db } from '../lib/firebase/app'
import type { Client } from '../types/client'
import type { Project } from '../types/project'

export interface ClientWithProjects extends Client {
  projects: Project[]
}

/**
 * Live clients → projects tree for the sidebar. Small team / small
 * client count, so a per-client projects subscription is fine —
 * no need for a collectionGroup query here.
 */
export function useClients(enabled = true) {
  const [clients, setClients] = useState<ClientWithProjects[]>([])
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) return
    const projectUnsubs = new Map<string, Unsubscribe>()
    const projectsByClient = new Map<string, Project[]>()

    function rebuild(clientDocs: { id: string; data: Client }[]) {
      setClients(
        clientDocs.map(({ id, data }) => ({
          ...data,
          id,
          projects: projectsByClient.get(id) || [],
        }))
      )
    }

    let latestClientDocs: { id: string; data: Client }[] = []

    const unsubClients = onSnapshot(
      query(collection(db, 'clients'), orderBy('name')),
      (snap) => {
        latestClientDocs = snap.docs.map((d) => ({ id: d.id, data: d.data() as Client }))
        setLoading(false)

        const currentIds = new Set(latestClientDocs.map((c) => c.id))

        // Drop subscriptions for removed clients
        for (const [clientId, unsub] of projectUnsubs) {
          if (!currentIds.has(clientId)) {
            unsub()
            projectUnsubs.delete(clientId)
            projectsByClient.delete(clientId)
          }
        }

        // Add subscriptions for new clients
        for (const clientId of currentIds) {
          if (projectUnsubs.has(clientId)) continue
          const unsub = onSnapshot(
            // No orderBy in the query: not every project has `orderIndex`
            // yet (Firestore would drop those), so sort client-side —
            // orderIndex first, name as the tiebreaker / fallback.
            collection(db, 'clients', clientId, 'projects'),
            (projSnap) => {
              projectsByClient.set(
                clientId,
                projSnap.docs
                  .map((d) => ({ id: d.id, ...d.data() }) as Project)
                  .sort(
                    (a, b) =>
                      (a.orderIndex ?? 1e9) - (b.orderIndex ?? 1e9) ||
                      a.name.localeCompare(b.name)
                  )
              )
              rebuild(latestClientDocs)
            }
          )
          projectUnsubs.set(clientId, unsub)
        }

        rebuild(latestClientDocs)
      },
      (err) => {
        console.error('useClients:', err.message)
        setLoading(false)
      }
    )

    return () => {
      unsubClients()
      for (const unsub of projectUnsubs.values()) unsub()
    }
  }, [enabled])

  return { clients, loading }
}
