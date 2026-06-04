import { apiFetch, apiJson } from './client.js'

const BASE = '/api/applications'

export async function fetchApplications() {
  const res = await apiFetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch applications')
  return res.json()
}

export async function fetchApplication(id) {
  const res = await apiFetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Failed to fetch application')
  return res.json()
}

export async function fetchApplicationGraph(id) {
  const res = await apiFetch(`${BASE}/${id}/graph`)
  if (!res.ok) throw new Error('Failed to fetch graph')
  return res.json()
}

export async function createApplication(name) {
  const res = await apiJson(BASE, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create application')
  return res.json()
}

export async function startApplicationAnalysis(id, mode = 'sequential') {
  const res = await apiJson(`${BASE}/${id}/analyze`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error('Failed to start analysis')
  return res.json()
}

export async function cancelApplication(id) {
  await apiFetch(`${BASE}/${id}/cancel`, { method: 'POST' })
}

export async function deleteApplication(id) {
  const res = await apiFetch(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete application')
}

export async function fetchApplicationMembers(id) {
  const res = await apiFetch(`${BASE}/${id}/members`)
  if (!res.ok) throw new Error('Failed to fetch members')
  return res.json()
}

export async function addApplicationMember(id, email) {
  const res = await apiJson(`${BASE}/${id}/members`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b.error || 'Failed to add member')
  }
  return res.json()
}

export async function removeApplicationMember(id, memberId) {
  const res = await apiFetch(`${BASE}/${id}/members/${memberId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to remove member')
  return res.json()
}
