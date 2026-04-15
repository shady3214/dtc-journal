import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppSettings, ThemeName } from '../../shared/types/domain'
import { getApi, loadSettings } from '../../shared/lib/api'
import { exportAllToExcel } from '../../shared/lib/excel'
import { useAccount } from '../../shared/contexts/AccountContext'
import {
  notificationScheduler,
  requestNotificationPermission,
  sendTestNotification,
  type FfEvent,
} from '../../shared/lib/notificationScheduler'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const THEMES: { id: ThemeName; color: string; label: string }[] = [
  { id: 'white',    color: '#3b7ef5', label: 'White'    },
  { id: 'amoled',   color: '#00e5ff', label: 'AMOLED'   },
]

function slugifyAccountName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'account'
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<AppSettings>(() => loadSettings())
  const [saved, setSaved] = useState(false)
  const [confirmAction, setConfirmAction] = useState<string | null>(null)
  const [dataNotice, setDataNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { accounts, activeAccount, addAccount, updateAccount, deleteAccount } = useAccount()

  // New account form state
  const [newAcctName, setNewAcctName] = useState('')
  const [newAcctCapital, setNewAcctCapital] = useState('')
  const [newAcctDesc, setNewAcctDesc] = useState('')

  // Edit account state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCapital, setEditCapital] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editIsPropFirm, setEditIsPropFirm] = useState(false)
  const [editMaxDD, setEditMaxDD] = useState('')
  const [editDailyLoss, setEditDailyLoss] = useState('')
  const [editProfitTarget, setEditProfitTarget] = useState('')
  const [editConsistency, setEditConsistency] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Current app version (read from Tauri at mount)
  const [currentVersion, setCurrentVersion] = useState('0.1.1')
  useEffect(() => {
    if (isTauri) {
      import('@tauri-apps/api/app').then(({ getVersion }) => {
        getVersion().then(v => setCurrentVersion(v)).catch(() => {})
      }).catch(() => {})
    }
  }, [])

  // Update checker state
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'upToDate' | 'error'>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateNotes, setUpdateNotes] = useState('')
  const [updateError, setUpdateError] = useState('')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [pendingUpdate, setPendingUpdate] = useState<any>(null)

  // Check for updates (Tauri only)
  const checkForUpdate = useCallback(async () => {
    if (!isTauri) return
    setUpdateStatus('checking')
    setUpdateError('')
    setUpdateVersion('')
    setUpdateNotes('')
    setPendingUpdate(null)
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      if (update) {
        setUpdateStatus('available')
        setUpdateVersion(update.version)
        setUpdateNotes(update.body || '')
        setPendingUpdate(update)
      } else {
        setUpdateStatus('upToDate')
      }
    } catch (err) {
      setUpdateStatus('error')
      setUpdateError(String(err instanceof Error ? err.message : err))
    }
  }, [])

  // Download and install update, then relaunch
  const installUpdate = useCallback(async () => {
    if (!pendingUpdate) return
    setUpdateStatus('downloading')
    setDownloadProgress(0)
    try {
      let totalLength = 0
      let downloaded = 0
      await pendingUpdate.downloadAndInstall((event: any) => {
        if (event.event === 'Started') {
          totalLength = event.data?.contentLength || 0
        } else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength || 0
          if (totalLength > 0) {
            setDownloadProgress(Math.round((downloaded / totalLength) * 100))
          }
        } else if (event.event === 'Finished') {
          setDownloadProgress(100)
        }
      })
      // Relaunch the app
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (err) {
      setUpdateStatus('error')
      setUpdateError(String(err instanceof Error ? err.message : err))
    }
  }, [pendingUpdate])

  // Persist on save
  const save = useCallback(async () => {
    // Merge the latest accounts from AccountContext into form before saving,
    // so that inline account edits are not overwritten by the stale form state.
    const latest = loadSettings()
    const merged = { ...form, accounts: latest.accounts, activeAccountId: latest.activeAccountId }
    await getApi().saveSettings(merged)
    // Sync starting capital to the legacy key used by EquityCurve
    localStorage.setItem('journal_starting_capital', form.startingCapital.toString())
    // Sync theme
    document.documentElement.setAttribute('data-theme', form.theme)
    localStorage.setItem('journal-theme', form.theme)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [form])

  useEffect(() => {
    setForm(loadSettings())
  }, [accounts, activeAccount.id])

  // Export data
  const handleExport = useCallback(async () => {
    try {
      const json = await getApi().exportAllData()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dtc-journal-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setDataNotice('Data exported successfully.')
      setTimeout(() => setDataNotice(''), 3000)
    } catch {
      setDataNotice('Export failed.')
      setTimeout(() => setDataNotice(''), 3000)
    }
  }, [])

  const handleAccountExport = useCallback(async (accountId: string, accountName: string) => {
    try {
      const api = getApi() as { exportAllData: () => Promise<string>; exportAccountData?: (accountId: string) => Promise<string> }
      const json = api.exportAccountData
        ? await api.exportAccountData(accountId)
        : await api.exportAllData()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dtc-journal-${slugifyAccountName(accountName)}-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setDataNotice(`${accountName} backup exported successfully.`)
      setTimeout(() => setDataNotice(''), 3000)
    } catch {
      setDataNotice(`Failed to export backup for ${accountName}.`)
      setTimeout(() => setDataNotice(''), 3000)
    }
  }, [])

  // Export to Excel
  const handleExcelExport = useCallback(async () => {
    try {
      const trades = await getApi().listTrades()
      const journals = await getApi().listJournalEntries()
      exportAllToExcel(trades, journals)
      setDataNotice('Excel file exported successfully.')
      setTimeout(() => setDataNotice(''), 3000)
    } catch {
      setDataNotice('Excel export failed.')
      setTimeout(() => setDataNotice(''), 3000)
    }
  }, [])

  // Import data
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const result = await getApi().importAllData(text)
      setDataNotice(`Imported ${result.trades} trade(s) and ${result.journals} journal entry(ies). Reload to see changes.`)
      setTimeout(() => setDataNotice(''), 5000)
    } catch {
      setDataNotice('Import failed. Make sure the file is a valid JSON backup.')
      setTimeout(() => setDataNotice(''), 4000)
    }
    // Reset input
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  // Danger zone actions
  const executeDanger = useCallback(async (action: string) => {
    try {
      if (action === 'clearTrades') {
        await getApi().clearTrades()
        setDataNotice('All trades deleted.')
      } else if (action === 'clearJournals') {
        await getApi().clearJournals()
        setDataNotice('All journal entries deleted.')
      } else if (action === 'clearAll') {
        await getApi().clearAllData()
        setDataNotice('All data cleared. Reload to reset.')
      }
    } catch {
      setDataNotice('Operation failed.')
    }
    setConfirmAction(null)
    setTimeout(() => setDataNotice(''), 4000)
  }, [])

  // Auto-close confirm after 5s
  useEffect(() => {
    if (!confirmAction) return
    const t = setTimeout(() => setConfirmAction(null), 5000)
    return () => clearTimeout(t)
  }, [confirmAction])

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  return (
    <div className="settings-page">
      {/* ── Account ──────────────────────────────────────────── */}
      <section className="card settings-section">
        <h3 className="settings-section-title">Account</h3>
        <div className="settings-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="settings-field">
            <label className="label">Display Name</label>
            <input
              type="text"
              placeholder="Trader"
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
            />
            <span className="settings-hint">Optional. Shown in the sidebar greeting.</span>
          </div>
        </div>
      </section>

      {/* ── Trading Accounts ─────────────────────────────────── */}
      <section className="card settings-section">
        <h3 className="settings-section-title">Trading Accounts</h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          Manage multiple trading accounts. Each account has its own trades, journal entries, and analytics.
        </p>

        {/* Account list */}
        <div className="accounts-list">
          {accounts.map((acct) => (
            <div
              key={acct.id}
              className={`account-card ${acct.id === activeAccount.id ? 'active-account' : ''}`}
            >
              <div className="account-card-avatar">
                {acct.name.charAt(0).toUpperCase()}
              </div>

              {editingId === acct.id ? (
                /* Inline edit form */
                <div className="account-edit-expanded">
                  <div className="account-edit-row">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Account name"
                      style={{ flex: 2 }}
                    />
                    <input
                      type="number"
                      value={editCapital}
                      onChange={(e) => setEditCapital(e.target.value)}
                      placeholder="Capital"
                      style={{ flex: 1 }}
                    />
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                      style={{ flex: 2 }}
                    />
                  </div>
                  {/* Prop firm toggle */}
                  <label className="propfirm-toggle-row">
                    <input
                      type="checkbox"
                      checked={editIsPropFirm}
                      onChange={(e) => setEditIsPropFirm(e.target.checked)}
                    />
                    <span>Prop Firm Account</span>
                    <span className="muted" style={{ fontSize: 12 }}>(enables live DD / target tracking on dashboard)</span>
                  </label>
                  {editIsPropFirm && (
                    <div className="propfirm-fields">
                      <div className="propfirm-field">
                        <label>Max Drawdown ($)</label>
                        <input type="number" min={0} step={100} placeholder="e.g. 10000"
                          value={editMaxDD} onChange={(e) => setEditMaxDD(e.target.value)} />
                      </div>
                      <div className="propfirm-field">
                        <label>Daily Loss Limit ($)</label>
                        <input type="number" min={0} step={100} placeholder="e.g. 2000"
                          value={editDailyLoss} onChange={(e) => setEditDailyLoss(e.target.value)} />
                      </div>
                      <div className="propfirm-field">
                        <label>Profit Target ($)</label>
                        <input type="number" min={0} step={100} placeholder="e.g. 10000"
                          value={editProfitTarget} onChange={(e) => setEditProfitTarget(e.target.value)} />
                      </div>
                      <div className="propfirm-field">
                        <label>Consistency Rule (%)</label>
                        <input type="number" min={0} max={100} step={1} placeholder="e.g. 40"
                          value={editConsistency} onChange={(e) => setEditConsistency(e.target.value)} />
                        <span className="muted" style={{ fontSize: 11 }}>No single day &gt; this % of total profit</span>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      className="mini-btn"
                      onClick={() => {
                        if (editName.trim()) {
                          updateAccount(acct.id, {
                            name: editName.trim(),
                            capital: parseFloat(editCapital) || 0,
                            description: editDesc.trim() || undefined,
                            isPropFirm: editIsPropFirm,
                            propMaxDrawdown: editIsPropFirm ? (parseFloat(editMaxDD) || undefined) : undefined,
                            propDailyLoss: editIsPropFirm ? (parseFloat(editDailyLoss) || undefined) : undefined,
                            propProfitTarget: editIsPropFirm ? (parseFloat(editProfitTarget) || undefined) : undefined,
                            propConsistencyRule: editIsPropFirm ? (parseFloat(editConsistency) || undefined) : undefined,
                          })
                        }
                        setEditingId(null)
                      }}
                    >
                      Save
                    </button>
                    <button className="mini-btn" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Read-only view */
                <>
                  <div className="account-card-info">
                    <div className="account-card-name">
                      {acct.name}
                      {acct.id === activeAccount.id && (
                        <span className="account-card-badge" style={{ marginLeft: 8 }}>Active</span>
                      )}
                      {acct.isPropFirm && (
                        <span className="account-card-badge propfirm-badge" style={{ marginLeft: 6 }}>Prop Firm</span>
                      )}
                    </div>
                    <div className="account-card-meta">
                      ${acct.capital.toLocaleString()} capital
                    </div>
                    {acct.description && (
                      <div className="account-card-desc">{acct.description}</div>
                    )}
                  </div>
                  <div className="account-card-actions">
                    <button
                      className="mini-btn"
                      onClick={() => {
                        setEditingId(acct.id)
                        setEditName(acct.name)
                        setEditCapital(acct.capital.toString())
                        setEditDesc(acct.description || '')
                        setEditIsPropFirm(acct.isPropFirm ?? false)
                        setEditMaxDD(acct.propMaxDrawdown?.toString() ?? '')
                        setEditDailyLoss(acct.propDailyLoss?.toString() ?? '')
                        setEditProfitTarget(acct.propProfitTarget?.toString() ?? '')
                        setEditConsistency(acct.propConsistencyRule?.toString() ?? '')
                      }}
                    >
                      Edit
                    </button>
                    {accounts.length > 1 && (
                      deleteConfirmId === acct.id ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="mini-btn delete-btn"
                            onClick={() => {
                              deleteAccount(acct.id)
                              setDeleteConfirmId(null)
                            }}
                          >
                            Confirm
                          </button>
                          <button className="mini-btn" onClick={() => setDeleteConfirmId(null)}>
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          className="mini-btn delete-btn"
                          onClick={() => setDeleteConfirmId(acct.id)}
                        >
                          Del
                        </button>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add new account form */}
        <div className="add-account-form">
          <div className="settings-field">
            <label className="label">Name</label>
            <input
              type="text"
              placeholder="e.g. Main, Demo, Funded"
              value={newAcctName}
              onChange={(e) => setNewAcctName(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label className="label">Capital ($)</label>
            <input
              type="number"
              min={0}
              step={100}
              placeholder="10000"
              value={newAcctCapital}
              onChange={(e) => setNewAcctCapital(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label className="label">Description</label>
            <input
              type="text"
              placeholder="Optional note"
              value={newAcctDesc}
              onChange={(e) => setNewAcctDesc(e.target.value)}
            />
          </div>
          <button
            className="btn-pill btn-primary add-account-btn"
            disabled={!newAcctName.trim()}
            onClick={() => {
              addAccount(
                newAcctName.trim(),
                parseFloat(newAcctCapital) || 0,
                newAcctDesc.trim() || undefined,
              )
              setNewAcctName('')
              setNewAcctCapital('')
              setNewAcctDesc('')
            }}
          >
            + Add Account
          </button>
        </div>
      </section>

      {/* ── Trading Defaults ─────────────────────────────────── */}
      <section className="card settings-section">
        <h3 className="settings-section-title">Trading Defaults</h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          These values pre-fill the trade form. You can still override them per trade.
        </p>
        <div className="settings-grid">
          <div className="settings-field">
            <label className="label">Default Capital ($)</label>
            <input
              type="number"
              min={0}
              step={100}
              value={form.defaultCapital || ''}
              onChange={(e) => set('defaultCapital', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="settings-field">
            <label className="label">Default Risk (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.25}
              value={form.defaultRiskPercent || ''}
              onChange={(e) => set('defaultRiskPercent', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="settings-field">
            <label className="label">Default Commission / Lot ($)</label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={form.defaultCommissionPerLot || ''}
              onChange={(e) => set('defaultCommissionPerLot', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="settings-field">
            <label className="label">Default Session</label>
            <select
              value={form.defaultSession}
              onChange={(e) => set('defaultSession', e.target.value)}
            >
              <option value="">None</option>
              <option value="Asian">Asian</option>
              <option value="London">London</option>
              <option value="New York">New York</option>
            </select>
          </div>
          <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
            <label className="label">Direct P&amp;L Input</label>
            <div className="toggle-row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={`toggle-btn ${form.defaultDirectPnl ? 'toggle-on' : ''}`}
                onClick={() => set('defaultDirectPnl', !form.defaultDirectPnl)}
              >
                <span className="toggle-thumb" />
              </button>
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                {form.defaultDirectPnl
                  ? 'Enter P&L directly — Entry/SL/TP hidden by default'
                  : 'Calculate from Entry / SL / TP (default)'}
              </span>
            </div>
            <span className="settings-hint">When on, new trades open with direct P&L mode pre-enabled. You can still toggle it per trade.</span>
          </div>
        </div>
      </section>

      {/* ── Admin Controls ────────────────────────────────────── */}
      <section className="card settings-section">
        <h3 className="settings-section-title">Admin Controls</h3>
        <p className="muted">
          AI provider keys/models are now hidden from end users and moved to the Admin page.
          Enable admin mode by setting <code>localStorage.journal_admin_mode = "1"</code>, then refresh.
        </p>
        <div style={{ marginTop: 12 }}>
          <button className="btn-pill btn-secondary" onClick={() => navigate('/admin')}>
            Open Admin Panel
          </button>
        </div>
      </section>

      {/* ── Theme ────────────────────────────────────────────── */}
      <section className="card settings-section">
        <h3 className="settings-section-title">Appearance</h3>
        <div className="settings-grid">
          <div className="settings-field" style={{ gridColumn: '1 / -1' }}>
            <label className="label">Theme</label>
            <div className="settings-theme-toggle">
              {THEMES.map(t => (
                <button
                  key={t.id}
                  className={`btn-pill theme-select-btn ${form.theme === t.id ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    set('theme', t.id)
                    document.documentElement.setAttribute('data-theme', t.id)
                    localStorage.setItem('journal-theme', t.id)
                  }}
                >
                  <span className="theme-dot-inline" style={{ background: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Alerts & Notifications ───────────────────────────── */}
      <NotificationsSection form={form} set={set} />

      {/* ── Data Management ──────────────────────────────────── */}
      <section className="card settings-section">
        <h3 className="settings-section-title">Data Management</h3>
        <div className="settings-data-row">
          <div className="settings-data-action">
            <h4>Export Backup</h4>
            <p className="muted">Download all trades, journal entries, and settings as a JSON file.</p>
            <button className="btn-pill btn-secondary" onClick={handleExport}>Export JSON</button>
          </div>
          <div className="settings-data-action">
            <h4>Export to Excel</h4>
            <p className="muted">Download all trades and journal entries as an Excel spreadsheet (.xlsx).</p>
            <button className="btn-pill btn-secondary" onClick={handleExcelExport}>Export Excel</button>
          </div>
          <div className="settings-data-action">
            <h4>Import Backup</h4>
            <p className="muted">Restore from a previously exported JSON backup. This replaces existing data.</p>
            <input type="file" accept=".json" ref={fileRef} onChange={handleImport} style={{ display: 'none' }} />
            <button className="btn-pill btn-secondary" onClick={() => fileRef.current?.click()}>Import JSON</button>
          </div>
        </div>
        <div className="settings-account-backups">
          <h4 className="settings-account-backups-title">Backup Individual Accounts</h4>
          <p className="muted">Export a separate JSON backup for each trading account using its account name.</p>
          <div className="settings-account-backup-list">
            {accounts.map((acct) => (
              <div key={acct.id} className="settings-account-backup-item">
                <div>
                  <div className="settings-account-backup-name">{acct.name}</div>
                  <div className="settings-account-backup-meta">{acct.id === activeAccount.id ? 'Currently active' : 'Inactive account'}</div>
                </div>
                <button className="btn-pill btn-secondary" onClick={() => handleAccountExport(acct.id, acct.name)}>
                  Export {acct.name}
                </button>
              </div>
            ))}
          </div>
        </div>
        {dataNotice && <p className="settings-data-notice">{dataNotice}</p>}
      </section>

      {/* ── App Updates (Tauri only) ────────────────────────── */}
      {isTauri && (
        <section className="card settings-section">
          <h3 className="settings-section-title">App Updates</h3>
          <div className="updater-info">
            <div className="updater-current">
              <span className="updater-label">Current Version</span>
              <span className="updater-version">v{currentVersion}</span>
            </div>

            {updateStatus === 'idle' && (
              <button className="btn-pill btn-secondary" onClick={checkForUpdate}>
                Check for Updates
              </button>
            )}

            {updateStatus === 'checking' && (
              <div className="updater-status">
                <span className="updater-spinner" />
                <span>Checking for updates...</span>
              </div>
            )}

            {updateStatus === 'upToDate' && (
              <div className="updater-status updater-ok">
                You're on the latest version.
                <button className="btn-pill btn-secondary" onClick={checkForUpdate} style={{ marginLeft: 12 }}>
                  Check Again
                </button>
              </div>
            )}

            {updateStatus === 'available' && (
              <div className="updater-available">
                <div className="updater-new-version">
                  <span className="updater-badge">Update Available</span>
                  <span className="updater-version">v{updateVersion}</span>
                </div>
                {updateNotes && (
                  <div className="updater-notes">
                    <p className="muted">{updateNotes}</p>
                  </div>
                )}
                <button className="btn-pill btn-primary" onClick={installUpdate}>
                  Download &amp; Install
                </button>
              </div>
            )}

            {updateStatus === 'downloading' && (
              <div className="updater-downloading">
                <span>Downloading update... {downloadProgress}%</span>
                <div className="updater-progress-track">
                  <div
                    className="updater-progress-fill"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  The app will restart automatically when done.
                </span>
              </div>
            )}

            {updateStatus === 'error' && (
              <div className="updater-status updater-fail">
                <span>Update failed: {updateError}</span>
                <button className="btn-pill btn-secondary" onClick={checkForUpdate} style={{ marginLeft: 12 }}>
                  Retry
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Danger Zone ──────────────────────────────────────── */}
      <section className="card settings-section settings-danger">
        <h3 className="settings-section-title" style={{ color: 'var(--danger)' }}>Danger Zone</h3>
        <div className="settings-data-row">
          <div className="settings-data-action">
            <h4>Clear All Trades</h4>
            <p className="muted">Permanently delete all trade records. This cannot be undone.</p>
            {confirmAction === 'clearTrades' ? (
              <div className="settings-confirm-group">
                <button className="btn-pill btn-danger" onClick={() => executeDanger('clearTrades')}>Confirm Delete</button>
                <button className="btn-pill btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn-pill btn-danger-outline" onClick={() => setConfirmAction('clearTrades')}>Delete Trades</button>
            )}
          </div>
          <div className="settings-data-action">
            <h4>Clear All Journals</h4>
            <p className="muted">Permanently delete all journal entries. This cannot be undone.</p>
            {confirmAction === 'clearJournals' ? (
              <div className="settings-confirm-group">
                <button className="btn-pill btn-danger" onClick={() => executeDanger('clearJournals')}>Confirm Delete</button>
                <button className="btn-pill btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn-pill btn-danger-outline" onClick={() => setConfirmAction('clearJournals')}>Delete Journals</button>
            )}
          </div>
          <div className="settings-data-action">
            <h4>Reset Everything</h4>
            <p className="muted">Delete all trades, journals, and settings. Start completely fresh.</p>
            {confirmAction === 'clearAll' ? (
              <div className="settings-confirm-group">
                <button className="btn-pill btn-danger" onClick={() => executeDanger('clearAll')}>Confirm Full Reset</button>
                <button className="btn-pill btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
              </div>
            ) : (
              <button className="btn-pill btn-danger-outline" onClick={() => setConfirmAction('clearAll')}>Reset All Data</button>
            )}
          </div>
        </div>
      </section>

      {/* ── Save Bar ─────────────────────────────────────────── */}
      <div className="settings-save-bar">
        <button className="btn-pill btn-primary" onClick={save}>
          Save Settings
        </button>
        {saved && <span className="settings-saved-badge">Settings saved</span>}
      </div>
    </div>
  )
}

// ── Notifications Section ────────────────────────────────────────

const ALL_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD']
const MINUTES_OPTIONS = [5, 10, 15, 20, 30]

function NotificationsSection({
  form,
  set,
}: {
  form: AppSettings
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}) {
  const [permStatus, setPermStatus] = useState<NotificationPermission | 'unknown'>('unknown')
  const [calendarEvents, setCalendarEvents] = useState<FfEvent[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarError, setCalendarError] = useState('')

  // Check current browser permission on mount and keep it live
  useEffect(() => {
    if (!('Notification' in window)) return
    const update = () => setPermStatus(Notification.permission)
    update()
    // Re-check every second so the UI reflects changes made outside the app
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  // When user enables notifications, immediately request permission
  const handleEnableToggle = useCallback(async () => {
    const next = !form.notificationsEnabled
    set('notificationsEnabled', next)
    if (next) {
      const perm = await requestNotificationPermission()
      setPermStatus(perm)
      if (perm === 'granted') {
        notificationScheduler.restart()
      }
    } else {
      notificationScheduler.stop()
    }
  }, [form.notificationsEnabled, set])

  // Toggle a currency in the watchlist
  const toggleCurrency = (cur: string) => {
    const list = form.notifyCurrencies ?? []
    const next = list.includes(cur) ? list.filter((c) => c !== cur) : [...list, cur]
    set('notifyCurrencies', next)
  }

  // Fetch today's events for preview
  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true)
    setCalendarError('')
    try {
      let data: FfEvent[]
      const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core')
        const text = await invoke<string>('proxy_ff_calendar')
        data = JSON.parse(text)
      } else {
        let resp: Response
        try {
          resp = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { signal: AbortSignal.timeout(8000) })
          if (!resp.ok) throw new Error('direct failed')
          data = await resp.json()
        } catch {
          resp = await fetch('/api/ff-calendar', { signal: AbortSignal.timeout(8000) })
          if (!resp.ok) throw new Error('proxy failed')
          data = await resp.json()
        }
      }
      const today = new Date().toISOString().slice(0, 10)
      const highToday = (data as FfEvent[])
        .filter((e) => e.impact === 'High' && e.date.startsWith(today))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      setCalendarEvents(highToday)
    } catch (err) {
      setCalendarError(String(err))
    } finally {
      setCalendarLoading(false)
    }
  }, [])

  const watchedCurrencies = form.notifyCurrencies ?? ['USD', 'EUR', 'GBP', 'JPY', 'CAD']

  return (
    <section className="card settings-section">
      <h3 className="settings-section-title">Alerts &amp; Notifications</h3>
      <p className="muted" style={{ marginBottom: 20 }}>
        Get desktop notifications before high-impact news events and market sessions.
        Uses the{' '}
        <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
          ForexFactory calendar
        </a>
        {' '}— no API key required.
      </p>

      {/* Master Toggle */}
      <div className="notif-master-row">
        <div className="notif-master-left">
          <span className="notif-master-label">Enable Notifications</span>
          <span className="settings-hint">
            {permStatus === 'denied'
              ? '⚠️ Browser/OS has blocked notifications. Allow them in your browser/system settings, then retry.'
              : permStatus === 'granted'
              ? '✅ Permission granted'
              : 'You will be prompted to allow notifications.'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="btn-pill btn-secondary notif-test-btn"
            onClick={sendTestNotification}
            title="Fire a test notification right now"
          >
            🔔 Test
          </button>
          <button
            type="button"
            className={`toggle-btn ${form.notificationsEnabled ? 'toggle-on' : ''}`}
            onClick={handleEnableToggle}
          >
            <span className="toggle-thumb" />
          </button>
        </div>
      </div>

      {form.notificationsEnabled && (
        <>
          {/* ── News Events ─────────────────────────── */}
          <div className="notif-subsection">
            <div className="notif-row-header">
              <span className="notif-row-label">📰 High-Impact News Alerts</span>
              <button
                type="button"
                className={`toggle-btn ${form.notifyNewsEvents ? 'toggle-on' : ''}`}
                onClick={() => set('notifyNewsEvents', !form.notifyNewsEvents)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            {form.notifyNewsEvents && (
              <>
                {/* Currency watchlist */}
                <div className="settings-field" style={{ marginTop: 14 }}>
                  <label className="label">Watch Currencies</label>
                  <div className="notif-currency-pills">
                    {ALL_CURRENCIES.map((cur) => (
                      <button
                        key={cur}
                        type="button"
                        className={`notif-currency-pill ${
                          watchedCurrencies.includes(cur) ? 'active' : ''
                        }`}
                        onClick={() => toggleCurrency(cur)}
                      >
                        {cur}
                      </button>
                    ))}
                  </div>
                  <span className="settings-hint">Only HIGH impact (red) events for selected currencies will alert.</span>
                </div>

                {/* Minutes before */}
                <div className="settings-field" style={{ marginTop: 14 }}>
                  <label className="label">Alert Time Before Event</label>
                  <div className="notif-time-pills">
                    {MINUTES_OPTIONS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`notif-time-pill ${
                          (form.notifyMinutesBefore ?? 15) === m ? 'active' : ''
                        }`}
                        onClick={() => set('notifyMinutesBefore', m)}
                      >
                        {m} min
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Session Alerts ──────────────────────── */}
          <div className="notif-subsection">
            <span className="notif-subsection-title">🕐 Session Open Alerts</span>

            {/* NY Open */}
            <div className="notif-session-row">
              <div className="notif-session-info">
                <span className="notif-session-name">🗽 New York Open</span>
                <span className="settings-hint">9:30 AM ET — NYSE opens, peak USD volatility</span>
              </div>
              <button
                type="button"
                className={`toggle-btn ${form.notifyNyOpen ? 'toggle-on' : ''}`}
                onClick={() => set('notifyNyOpen', !form.notifyNyOpen)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            {form.notifyNyOpen && (
              <div className="settings-field" style={{ marginLeft: 16, marginTop: 8 }}>
                <label className="label">Alert Time Before Open</label>
                <div className="notif-time-pills">
                  {MINUTES_OPTIONS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`notif-time-pill ${
                        (form.notifyNyOpenMinutesBefore ?? 15) === m ? 'active' : ''
                      }`}
                      onClick={() => set('notifyNyOpenMinutesBefore', m)}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* London Open */}
            <div className="notif-session-row" style={{ marginTop: 12 }}>
              <div className="notif-session-info">
                <span className="notif-session-name">🇬🇧 London Open</span>
                <span className="settings-hint">8:00 AM GMT — highest liquidity session of the day</span>
              </div>
              <button
                type="button"
                className={`toggle-btn ${form.notifyLondonOpen ? 'toggle-on' : ''}`}
                onClick={() => set('notifyLondonOpen', !form.notifyLondonOpen)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
          </div>

          {/* ── Calendar Preview ─────────────────────── */}
          <div className="notif-subsection">
            <div className="notif-row-header">
              <span className="notif-subsection-title">📅 Today's High-Impact Events</span>
              <button
                className="btn-pill btn-secondary"
                onClick={loadCalendar}
                disabled={calendarLoading}
                style={{ fontSize: 12, padding: '4px 12px' }}
              >
                {calendarLoading ? 'Loading...' : 'Load Calendar'}
              </button>
            </div>

            {calendarError && (
              <p style={{ color: 'var(--negative)', fontSize: 13, marginTop: 8 }}>
                {calendarError}
              </p>
            )}

            {calendarEvents.length === 0 && !calendarLoading && !calendarError && (
              <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                Click "Load Calendar" to preview today's scheduled high-impact events.
              </p>
            )}

            {calendarEvents.length > 0 && (
              <div className="notif-calendar-list">
                {calendarEvents.map((ev, i) => {
                  const evTime = new Date(ev.date)
                  const watched = watchedCurrencies.includes(ev.country)
                  return (
                    <div key={i} className={`notif-calendar-item ${watched ? 'watched' : 'unwatched'}`}>
                      <div className="notif-cal-flag">
                        <span className="notif-cal-badge" style={{ background: 'var(--negative)' }}>
                          {ev.country}
                        </span>
                      </div>
                      <div className="notif-cal-body">
                        <span className="notif-cal-title">{ev.title}</span>
                        <span className="notif-cal-time">
                          {evTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {ev.forecast ? ` · Forecast: ${ev.forecast}` : ''}
                          {ev.previous ? ` · Prev: ${ev.previous}` : ''}
                        </span>
                      </div>
                      {watched && <span className="notif-cal-dot" />}
                    </div>
                  )
                })}
              </div>
            )}

            {calendarEvents.length === 0 && !calendarLoading && !calendarError && (
              <></>
            )}
          </div>
        </>
      )}
    </section>
  )
}
