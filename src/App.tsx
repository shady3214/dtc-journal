import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider, useAuth } from './shared/contexts/AuthContext'
import { AccountProvider } from './shared/contexts/AccountContext'
import { setSupabaseUserId, migrateLocalStorageToFiles, loadSettingsAsync } from './shared/lib/api'
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

function DataInit() {
  useEffect(() => {
    // On Tauri: migrate any existing localStorage data to AppData files (one-time),
    // then sync AppData files back to localStorage so the rest of the app reads correctly.
    async function init() {
      await migrateLocalStorageToFiles()
      // Sync AppData → localStorage so AccountContext and other sync readers see latest data
      await loadSettingsAsync()
    }
    init().catch(() => {})
  }, [])
  return null
}

function App() {
  return (
    <AuthProvider>
      <AuthSync />
      <NotificationInit />
      <DataInit />
      <AccountProvider>
        <RouterProvider router={router} />
      </AccountProvider>
    </AuthProvider>
  )
}

export default App
