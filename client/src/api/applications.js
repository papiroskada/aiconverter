const BASE = '/api/applications'

export async function createApplication(name) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create application')
  return res.json()
}

export async function fetchApplication(id) {
  const res = await fetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Failed to fetch application')
  return res.json()
}

export async function startApplicationAnalysis(id, mode) {
  const res = await fetch(`${BASE}/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error('Failed to start analysis')
  return res.json()
}

export async function cancelApplication(id) {
  await fetch(`${BASE}/${id}/cancel`, { method: 'POST' })
}
