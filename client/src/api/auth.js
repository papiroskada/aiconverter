import { apiJson, apiFetch } from './client.js'

export async function login(email, password) {
  const res = await apiJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Login failed')
  }
  return res.json()
}

export async function logout() {
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
}

export async function refreshSession() {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

export async function fetchMe() {
  const res = await apiFetch('/api/auth/me')
  if (!res.ok) return null
  return res.json()
}
