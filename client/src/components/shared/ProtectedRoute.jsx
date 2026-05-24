import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext.jsx'

export default function ProtectedRoute({ roles }) {
  const { user, role, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (roles && !roles.includes(role)) return <Navigate to="/" replace />

  return <Outlet />
}
