import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { AppShell } from '../layout/AppShell'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { TradesPage } from '../features/trades/TradesPage'
import { AnalyticsPage } from '../features/analytics/AnalyticsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { JournalPage } from '../features/journal/JournalPage'
import { LoginPage } from '../features/auth/LoginPage'
import { useAuth } from '../shared/contexts/AuthContext'

function AuthGuard() {
  const { user, loading, configured } = useAuth()

  // No Supabase configured → skip auth, run in local-only mode
  if (!configured) {
    return <Outlet />
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
        <p>Loading...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function PublicOnly() {
  const { user, loading, configured } = useAuth()

  // No Supabase configured → redirect away from login (nothing to log into)
  if (!configured) {
    return <Navigate to="/" replace />
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
    ],
  },
  {
    element: <AuthGuard />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'trades', element: <TradesPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
          { path: 'journal', element: <JournalPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
])
