import { useEffect, useRef } from 'react'
import { getAccessToken } from '@/api/client.js'

export function useAppSSE(applicationId, onEvent) {
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent })

  useEffect(() => {
    if (!applicationId) return
    const token = getAccessToken()
    const es = new EventSource(`/api/applications/${applicationId}/stream${token ? `?token=${token}` : ''}`)

    const handle = (e) => {
      try {
        onEventRef.current(e.type, JSON.parse(e.data))
      } catch (err) {
        console.error('App SSE parse error', err)
      }
    }

    ;['progress', 'done', 'failed'].forEach(event => es.addEventListener(event, handle))

    es.onerror = () => {
      onEventRef.current('error', null)
      es.close()
    }

    return () => es.close()
  }, [applicationId])
}
