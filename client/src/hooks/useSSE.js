import { useEffect, useRef } from 'react'
import { getAccessToken } from '@/api/client.js'

export function useSSE(programId, onEvent) {
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent })

  useEffect(() => {
    if (!programId) return
    const token = getAccessToken()
    const es = new EventSource(`/api/programs/${programId}/stream${token ? `?token=${token}` : ''}`)

    const handle = (e) => {
      try {
        onEventRef.current(e.type, JSON.parse(e.data))
      } catch (err) {
        console.error('SSE parse error', err)
      }
    }

    ;['chunk_done', 'metadata', 'done', 'failed', 'progress'].forEach(event =>
      es.addEventListener(event, handle)
    )

    return () => es.close()
  }, [programId])
}
