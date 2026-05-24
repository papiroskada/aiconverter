let accessToken = null
let refreshing = null

export function setAccessToken(token) {
  accessToken = token
}

export function clearAccessToken() {
  accessToken = null
}

async function doRefresh() {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!res.ok) return false
  const data = await res.json()
  accessToken = data.accessToken
  return true
}

export async function apiFetch(url, options = {}) {
  const headers = { ...options.headers }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  let res = await fetch(url, { ...options, headers, credentials: 'include' })

  if (res.status === 401 && !options._retry) {
    // serialize concurrent refresh attempts
    if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null })
    const ok = await refreshing

    if (ok) {
      headers['Authorization'] = `Bearer ${accessToken}`
      res = await fetch(url, { ...options, _retry: true, headers, credentials: 'include' })
    } else {
      clearAccessToken()
      window.dispatchEvent(new Event('auth:logout'))
      throw new Error('Session expired')
    }
  }

  return res
}

export function apiJson(url, options = {}) {
  return apiFetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
}
