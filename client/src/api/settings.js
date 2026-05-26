import { apiFetch, apiJson } from './client.js'

const BASE = '/api/settings'

export async function fetchSettings() {
  const res = await apiFetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

export async function saveSettings(fields) {
  const res = await apiJson(BASE, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || 'Failed to save settings')
  }
}
