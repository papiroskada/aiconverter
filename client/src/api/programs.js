import { apiFetch, apiJson } from './client.js'

const BASE = '/api/programs'

export async function fetchGraph() {
  const res = await apiFetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch programs')
  return res.json()
}

export async function fetchProgram(id) {
  const res = await apiFetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Failed to fetch program')
  return res.json()
}

export async function uploadFile(file, applicationId = null, companion = null) {
  const form = new FormData()
  form.append('file', file)
  if (applicationId) form.append('application_id', applicationId)
  if (companion) form.append('companion', companion)
  const res = await apiFetch(`${BASE}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}

export async function triggerReanalyze(id) {
  const res = await apiFetch(`${BASE}/${id}/analyze`, { method: 'POST' })
  if (!res.ok) throw new Error('Reanalyze failed')
  return res.json()
}

export async function deleteProgram(id) {
  const res = await apiFetch(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || 'Delete failed')
  }
}

export async function cancelAnalysis(id) {
  const res = await apiFetch(`${BASE}/${id}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error('Cancel failed')
  return res.json()
}

export async function patchEntryPoints(id, entryPoints) {
  const res = await apiJson(`${BASE}/${id}/entry-points`, {
    method: 'PATCH',
    body: JSON.stringify({ entry_points: entryPoints }),
  })
  if (!res.ok) throw new Error('Failed to save entry points')
  return res.json()
}

export async function patchFlags(id, condition, flag) {
  const res = await apiJson(`${BASE}/${id}/flags`, {
    method: 'PATCH',
    body: JSON.stringify({ condition, flag }),
  })
  if (!res.ok) throw new Error('Failed to update flag')
  return res.json()
}

export async function generateFullProgram(id, { includeTests = false } = {}) {
  const res = await apiJson(`${BASE}/${id}/generate-program`, {
    method: 'POST',
    body: JSON.stringify({ includeTests }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b?.error || 'Generate failed')
  }
  return res.json()
}

export async function generateProjectFiles(appId, { includeTests = false } = {}) {
  const res = await apiJson(`${BASE}/application/${appId}/generate-project`, {
    method: 'POST',
    body: JSON.stringify({ includeTests }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b?.error || 'Generate failed')
  }
  return res.json()
}

export async function generateProgramTypes(programIds) {
  const res = await apiJson(`${BASE}/program-types`, {
    method: 'POST',
    body: JSON.stringify({ programIds }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b?.error || 'Types generation failed')
  }
  return res.json()
}

export async function getGeneratedCode(id) {
  const res = await apiFetch(`${BASE}/${id}/generated-code`)
  if (!res.ok) throw new Error('Failed to fetch cached code')
  return res.json()
}

export async function generateApplicationCode(appId) {
  const res = await apiFetch(`${BASE}/application/${appId}/generate`, { method: 'POST' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b?.error || 'Generate failed')
  }
  return res.json()
}

export async function fetchCallers(name) {
  const res = await apiFetch(`${BASE}/callers/${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error('Failed to fetch callers')
  return res.json()
}

export async function fetchCalls(id) {
  const res = await apiFetch(`${BASE}/${id}/calls`)
  if (!res.ok) throw new Error('Failed to fetch calls')
  return res.json()
}
