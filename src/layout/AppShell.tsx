import dayjs from 'dayjs'
import { useEffect, useState, useCallback } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { loadSettings, persistSettings } from '../shared/lib/api'
import { useAuth } from '../shared/contexts/AuthContext'
import { useAccount } from '../shared/contexts/AccountContext'
import type { ThemeName } from '../shared/types/domain'
import { notificationScheduler, requestNotificationPermission } from '../shared/lib/notificationScheduler'

const THEMES: { id: ThemeName; color: string; label: string }[] = [
  { id: 'obsidian', color: '#22c55e', label: 'Obsidian' },
  { id: 'midnight', color: '#3b82f6', label: 'Midnight' },
  { id: 'ember', color: '#f59e0b', label: 'Ember' },
  { id: 'crimson', color: '#f43f5e', label: 'Crimson' },
  { id: 'phantom', color: '#a855f7', label: 'Phantom' },
  { id: 'white', color: '#0ea5e9', label: 'White' },
  { id: 'amoled', color: '#00e5ff', label: 'AMOLED' },
]

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/trades', label: 'Trades', icon: 'trades' },
  { to: '/analytics', label: 'Analytics', icon: 'analytics' },
  { to: '/journal', label: 'Journal', icon: 'journal' },
  { to: '/news-calendar', label: 'News Calendar', icon: 'news-calendar' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

function NavIcon({ name }: { name: string }) {
  const p = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'dashboard':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      )
    case 'trades':
      return (
        <svg {...p}>
          <line x1="12" y1="20" x2="12" y2="4" />
          <polyline points="5 11 12 4 19 11" />
        </svg>
      )
    case 'analytics':
      return (
        <svg {...p}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      )
    case 'journal':
      return (
        <svg {...p}>
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </svg>
      )
    case 'news-calendar':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <circle cx="8" cy="15" r="1" fill="currentColor" />
          <circle cx="12" cy="15" r="1" fill="currentColor" />
          <circle cx="16" cy="15" r="1" fill="currentColor" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...p}>
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      )
    default:
      return null
  }
}

export function AppShell() {
  const location = useLocation()
  const { user, signOut, configured } = useAuth()
  const { accounts, activeAccount, switchAccount } = useAccount()
  const [acctDropdownOpen, setAcctDropdownOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(() => {
    const s = loadSettings()
    return s.theme || 'obsidian'
  })
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem('sidebar-open') !== 'false'
  })

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('journal-theme', theme)
  }, [theme])

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('sidebar-open', String(sidebarOpen))
  }, [sidebarOpen])

  // Cursor glow - uses CSS custom properties for performance (no React re-renders)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--cursor-x', `${e.clientX}px`)
      document.documentElement.style.setProperty('--cursor-y', `${e.clientY}px`)
    }
    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [])

  // Start notification scheduler
  useEffect(() => {
    const s = loadSettings()
    if (s.notificationsEnabled) {
      requestNotificationPermission().then((perm) => {
        if (perm === 'granted') notificationScheduler.start()
      })
    }
    return () => notificationScheduler.stop()
  }, [])

  const switchTheme = useCallback((id: ThemeName) => {
    setTheme(id)
    const settings = loadSettings()
    settings.theme = id
    persistSettings(settings)
  }, [])

  const cycleTheme = useCallback(() => {
    const idx = THEMES.findIndex((t) => t.id === theme)
    const next = THEMES[(idx + 1) % THEMES.length]
    switchTheme(next.id)
  }, [theme, switchTheme])

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <div className="cursor-glow" />

      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand-row">
            <h1 className="brand">
              {sidebarOpen ? (
                <>DTC <span className="brand-accent">Journal</span></>
              ) : (
                <span className="brand-accent">D</span>
              )}
            </h1>
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: sidebarOpen ? 'none' : 'rotate(180deg)', transition: 'transform 0.3s' }}
              >
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          </div>
          {sidebarOpen && <p className="sidebar-tagline">Trading Performance Tracker</p>}
        </div>

        {/* Account Switcher */}
        <div className="account-switcher">
          <button
            className="account-switcher-btn"
            onClick={() => setAcctDropdownOpen(!acctDropdownOpen)}
            title={activeAccount.name}
          >
            <div className="account-switcher-avatar">
              {activeAccount.name.charAt(0).toUpperCase()}
            </div>
            {sidebarOpen && (
              <>
                <div className="account-switcher-info">
                  <span className="account-switcher-name">{activeAccount.name}</span>
                  <span className="account-switcher-capital">
                    ${activeAccount.capital.toLocaleString()}
                  </span>
                </div>
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className={`account-switcher-chevron ${acctDropdownOpen ? 'open' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </>
            )}
          </button>

          {acctDropdownOpen && sidebarOpen && (
            <div className="account-dropdown">
              {accounts.map((acct) => (
                <button
                  key={acct.id}
                  className={`account-dropdown-item ${acct.id === activeAccount.id ? 'active' : ''}`}
                  onClick={() => {
                    switchAccount(acct.id)
                    setAcctDropdownOpen(false)
                  }}
                >
                  <div className="account-dropdown-avatar">
                    {acct.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="account-dropdown-info">
                    <span className="account-dropdown-name">{acct.name}</span>
                    <span className="account-dropdown-capital">${acct.capital.toLocaleString()}</span>
                  </div>
                  {acct.id === activeAccount.id && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
              <NavLink
                to="/settings"
                className="account-dropdown-manage"
                onClick={() => setAcctDropdownOpen(false)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Manage Accounts
              </NavLink>
            </div>
          )}
        </div>

        <hr className="sidebar-divider" />
        {sidebarOpen && <p className="sidebar-label">Navigation</p>}

        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className="nav-item"
              title={!sidebarOpen ? item.label : undefined}
            >
              <NavIcon name={item.icon} />
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <hr className="sidebar-divider" />

          {/* User info */}
          {configured && user && (
            <div className="sidebar-user">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt=""
                  className="sidebar-user-avatar"
                />
              ) : (
                <div className="sidebar-user-avatar sidebar-user-avatar-placeholder">
                  {(user.user_metadata?.full_name?.[0] || user.email?.[0] || '?').toUpperCase()}
                </div>
              )}
              {sidebarOpen && (
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">
                    {user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'}
                  </span>
                  <button className="sidebar-signout-btn" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}

          <hr className="sidebar-divider" />
          {sidebarOpen && <p className="sidebar-label">Theme</p>}
          <div className={`theme-dots ${sidebarOpen ? '' : 'theme-dots-vertical'}`}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-dot ${theme === t.id ? 'active' : ''}`}
                style={{ '--dot-color': t.color } as React.CSSProperties}
                onClick={() => switchTheme(t.id)}
                title={t.label}
              />
            ))}
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h2>
              {location.pathname === '/'
                ? 'Dashboard'
                : location.pathname === '/news-calendar'
                ? 'News Calendar'
                : location.pathname.slice(1).replace(/^\w/, (c) => c.toUpperCase())}
            </h2>
            <p className="label" style={{ marginTop: 4 }}>
              {dayjs().format('dddd, MMM D, YYYY')}
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="theme-toggle-btn"
              onClick={cycleTheme}
              title={`Theme: ${THEMES.find((t) => t.id === theme)?.label}`}
            >
              <span
                className="theme-dot-mini"
                style={{ background: THEMES.find((t) => t.id === theme)?.color }}
              />
            </button>
            <div className="quick-filters">
              <button>Today</button>
              <button>This Week</button>
              <button>This Month</button>
            </div>
          </div>
        </header>
        <section className="page-body">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
