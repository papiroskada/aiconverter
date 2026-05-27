import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { login as apiLogin, logout as apiLogout, refreshSession } from '@/api/auth.js'
import { setAccessToken, clearAccessToken } from '@/api/client.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  // On mount: try to restore session via refresh token cookie
  useEffect(() => {
    refreshSession()
      .then(data => {
        if (data) {
          setAccessToken(data.accessToken)
          setUser(data.user)
        }
      })
      .finally(() => setIsLoading(false))
  }, [])

  // Listen for session expiry from api/client.js
  useEffect(() => {
    function handleLogout() {
      setUser(null)
      clearAccessToken()
    }
    window.addEventListener('auth:logout', handleLogout)
    return () => window.removeEventListener('auth:logout', handleLogout)
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await apiLogin(email, password)
    setAccessToken(data.accessToken)
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    clearAccessToken()
    setUser(null)
  }, [])

  const updateUser = useCallback((updates) => {
    setUser(prev => prev ? { ...prev, ...updates } : prev)
  }, [])

  return (
    <AuthContext.Provider value={{ user, role: user?.role ?? null, isLoading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
