import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { AuthProvider, useAuth } from './shared/contexts/AuthContext'
import { AccountProvider } from './shared/contexts/AccountContext'
import { setSupabaseUserId } from './shared/lib/api'

function AuthSync() {
  const { user } = useAuth()

  useEffect(() => {
    setSupabaseUserId(user?.id ?? null)
  }, [user])

  return null
}

function App() {
  return (
    <AuthProvider>
      <AuthSync />
      <AccountProvider>
        <RouterProvider router={router} />
      </AccountProvider>
    </AuthProvider>
  )
}

export default App
