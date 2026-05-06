const BASE = '/api/programs'

export async function fetchGraph() {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch graph')
  return res.json()
}

export async function fetchProgram(id) {
  const res = await fetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Failed to fetch program')
  return res.json()
}

export async function uploadFile(file, applicationId = null, companion = null) {
  const form = new FormData()
  form.append('file', file)
  if (applicationId) form.append('application_id', applicationId)
  if (companion) form.append('companion', companion)
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}

export async function triggerReanalyze(id) {
  const res = await fetch(`${BASE}/${id}/analyze`, { method: 'POST' })
  if (!res.ok) throw new Error('Reanalyze failed')
  return res.json()
}

export async function deleteProgram(id) {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    let message = 'Delete failed'
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {}
    throw new Error(message)
  }
}

export async function cancelAnalysis(id) {
  const res = await fetch(`${BASE}/${id}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error('Cancel failed')
  return res.json()
}

export async function patchEntryPoints(id, entryPoints) {
  const res = await fetch(`${BASE}/${id}/entry-points`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry_points: entryPoints }),
  })
  if (!res.ok) throw new Error('Failed to save entry points')
  return res.json()
}

export async function patchFlags(id, condition, flag) {
  const res = await fetch(`${BASE}/${id}/flags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ condition, flag }),
  })
  if (!res.ok) throw new Error('Failed to update flag')
  return res.json()
}
