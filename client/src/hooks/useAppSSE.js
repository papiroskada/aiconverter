import { useEffect, useRef } from 'react'

export function useAppSSE(applicationId, onEvent) {
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent })

  useEffect(() => {
    if (!applicationId) return
    const es = new EventSource(`/api/applications/${applicationId}/stream`)

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
