import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  /** True when Supabase env vars are present */
  configured: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  configured: false,
  signInWithGoogle: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  // When Supabase is not configured, skip the loading state entirely
  const [loading, setLoading] = useState(supabaseConfigured)

  useEffect(() => {
    if (!supabaseConfigured) return

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false)
      }
    )

    // In Tauri: listen for deep link callbacks (dtcjournal://auth/callback#access_token=...)
    let unlistenDeepLink: (() => void) | null = null
    if (isTauri) {
      import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
        onOpenUrl(async (urls: string[]) => {
          for (const url of urls) {
            if (url.startsWith('dtcjournal://')) {
              const hash = url.split('#')[1]
              if (hash) {
                const params = new URLSearchParams(hash)
                const accessToken = params.get('access_token')
                const refreshToken = params.get('refresh_token')
                if (accessToken && refreshToken) {
                  await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
                }
              }
            }
          }
        }).then((fn: () => void) => { unlistenDeepLink = fn })
      }).catch(() => {})
    }

    return () => {
      subscription.unsubscribe()
      unlistenDeepLink?.()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!supabaseConfigured) throw new Error('Supabase is not configured')
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

    if (isTauri) {
      // In Tauri: open OAuth in system browser, redirect back via deep link
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'dtcjournal://auth/callback',
          skipBrowserRedirect: true,
        },
      })
      if (error) throw error
      if (data?.url) {
        const { open } = await import('@tauri-apps/plugin-shell')
        await open(data.url)
      }
    } else {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, loading, configured: supabaseConfigured, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
