import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { getFirebaseServices } from '../../lib/firebase/client'
import { getMySubmissionManagement, type SubmissionManagement } from './api'

type ManagementState = {
  phase: 'signed_out' | 'loading' | 'ready' | 'error'
  records: Map<string, SubmissionManagement>
}

export function useSubmissionManagement(ids: string[]) {
  const services = useMemo(() => getFirebaseServices(), [])
  const idsKey = ids.join('\u0000')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ManagementState>({ phase: 'loading', records: new Map() })

  useEffect(() => {
    if (!services) return
    let generation = 0
    const unsubscribe = onAuthStateChanged(services.auth, (user) => {
      const current = ++generation
      setState({ phase: user ? 'loading' : 'signed_out', records: new Map() })
      if (!user || !idsKey) {
        if (user) setState({ phase: 'ready', records: new Map() })
        return
      }
      const requested = idsKey.split('\u0000')
      void Promise.all(Array.from({ length: Math.ceil(requested.length / 30) }, (_, index) =>
        getMySubmissionManagement(requested.slice(index * 30, (index + 1) * 30)),
      )).then((pages) => {
        if (current !== generation || services.auth.currentUser?.uid !== user.uid) return
        setState({ phase: 'ready', records: new Map(pages.flat().map((record) => [record.id, record])) })
      }).catch(() => {
        if (current === generation && services.auth.currentUser?.uid === user.uid) {
          setState({ phase: 'error', records: new Map() })
        }
      })
    })
    return () => { generation += 1; unsubscribe() }
  }, [attempt, idsKey, services])

  return { ...state, retry: () => setAttempt((value) => value + 1) }
}
