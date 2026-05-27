import { apiFetch, apiJson } from './client.js'

const BASE = '/api/users'

export async function fetchUsers() {
  const res = await apiFetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch users')
  return res.json()
}

export async function createUser(data) {
  const res = await apiJson(BASE, { method: 'POST', body: JSON.stringify(data) })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b.error || 'Failed to create user')
  }
  return res.json()
}

export async function updateUser(id, data) {
  const res = await apiJson(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b.error || 'Failed to update user')
  }
  return res.json()
}

export async function fetchTokenStats() {
  const res = await apiFetch(`${BASE}/token-stats`)
  if (!res.ok) throw new Error('Failed to fetch token stats')
  return res.json()
}
