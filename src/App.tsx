import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider, useAuth } from './shared/contexts/AuthContext'
import { AccountProvider } from './shared/contexts/AccountContext'
import { setSupabaseUserId } from './shared/lib/api'
import { notificationScheduler } from './shared/lib/notificationScheduler'

function AuthSync() {
  const { user } = useAuth()

  useEffect(() => {
    setSupabaseUserId(user?.id ?? null)
  }, [user])

  return null
}

function NotificationInit() {
  useEffect(() => {
    // Start the notification scheduler (it self-checks if enabled in settings)
    notificationScheduler.start()
    return () => notificationScheduler.stop()
  }, [])
  return null
}

function App() {
  return (
    <AuthProvider>
      <AuthSync />
      <NotificationInit />
      <AccountProvider>
        <RouterProvider router={router} />
      </AccountProvider>
    </AuthProvider>
  )
}

export default App
