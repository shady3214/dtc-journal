import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { TradingAccount } from '../types/domain'
import { getApi, loadSettings, persistSettings } from '../lib/api'
import { useAuth } from './AuthContext'

interface AccountState {
  accounts: TradingAccount[]
  activeAccount: TradingAccount
  switchAccount: (id: string) => void
  addAccount: (name: string, capital: number, description?: string) => TradingAccount
  updateAccount: (id: string, updates: Partial<Pick<TradingAccount, 'name' | 'capital' | 'description'>>) => void
  deleteAccount: (id: string) => void
  /** Incremented on switch so pages can re-fetch data */
  refreshKey: number
}

const AccountContext = createContext<AccountState | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState(() => loadSettings())
  const [refreshKey, setRefreshKey] = useState(0)

  const accounts = settings.accounts
  const activeAccount = accounts.find((a) => a.id === settings.activeAccountId) || accounts[0]

  const persist = useCallback(async (updated: typeof settings) => {
    setSettings(updated)
    persistSettings(updated)
    if (user) {
      await getApi().saveSettings(updated)
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      setSettings(loadSettings())
      return
    }

    getApi().getSettings()
      .then((cloudSettings) => setSettings(cloudSettings))
      .catch(() => setSettings(loadSettings()))
  }, [user])

  const switchAccount = useCallback((id: string) => {
    const s = loadSettings()
    if (s.accounts.some((a) => a.id === id)) {
      s.activeAccountId = id
      void persist(s)
      setRefreshKey((k) => k + 1)
    }
  }, [persist])

  const addAccount = useCallback((name: string, capital: number, description?: string) => {
    const s = loadSettings()
    const newAcct: TradingAccount = {
      id: crypto.randomUUID(),
      name,
      capital,
      description,
      createdAt: new Date().toISOString(),
    }
    s.accounts.push(newAcct)
    void persist(s)
    return newAcct
  }, [persist])

  const updateAccount = useCallback((id: string, updates: Partial<Pick<TradingAccount, 'name' | 'capital' | 'description'>>) => {
    const s = loadSettings()
    const acct = s.accounts.find((a) => a.id === id)
    if (acct) {
      if (updates.name !== undefined) acct.name = updates.name
      if (updates.capital !== undefined) acct.capital = updates.capital
      if (updates.description !== undefined) acct.description = updates.description
      void persist(s)
    }
  }, [persist])

  const deleteAccount = useCallback((id: string) => {
    const s = loadSettings()
    // Cannot delete the last account
    if (s.accounts.length <= 1) return
    s.accounts = s.accounts.filter((a) => a.id !== id)
    // If deleted the active one, switch to first remaining
    if (s.activeAccountId === id) {
      s.activeAccountId = s.accounts[0].id
      setRefreshKey((k) => k + 1)
    }
    void persist(s)
  }, [persist])

  return (
    <AccountContext.Provider value={{ accounts, activeAccount, switchAccount, addAccount, updateAccount, deleteAccount, refreshKey }}>
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}
