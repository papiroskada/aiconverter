import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/auth/AuthContext.jsx'
import ProtectedRoute from '@/components/shared/ProtectedRoute.jsx'
import LoginPage from '@/pages/LoginPage.jsx'
import AppShell from '@/components/layout/AppShell.jsx'
import ProjectsPage from '@/pages/ProjectsPage.jsx'
import ProjectDetailPage from '@/pages/ProjectDetailPage.jsx'
import GraphPage from '@/pages/GraphPage.jsx'
import UsersPage from '@/pages/admin/UsersPage.jsx'
import SettingsPage from '@/pages/admin/SettingsPage.jsx'

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="bottom-right" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/projects" replace />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:appId" element={<ProjectDetailPage />} />
              <Route path="/graph" element={<GraphPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route element={<AppShell />}>
              <Route path="/admin/users" element={<UsersPage />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
