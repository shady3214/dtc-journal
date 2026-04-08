import { useCallback, useEffect, useRef, useState } from 'react'
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
  { id: 'obsidian', color: '#22c55e', label: 'Obsidian' },
  { id: 'midnight', color: '#3b82f6', label: 'Midnight' },
  { id: 'ember', color: '#f59e0b', label: 'Ember' },
  { id: 'crimson', color: '#f43f5e', label: 'Crimson' },
  { id: 'phantom', color: '#a855f7', label: 'Phantom' },
  { id: 'white', color: '#0ea5e9', label: 'White' },
  { id: 'amoled', color: '#00e5ff', label: 'AMOLED' },
]

export function SettingsPage() {
  const [form, setForm] = useState<AppSettings>(() => loadSettings())
  const [saved, setSaved] = useState(false)
  const [aiStatus, setAiStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [aiError, setAiError] = useState('')
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

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

  // Test AI connection
  const testAi = useCallback(async () => {
    setAiStatus('testing')
    setAiError('')
    try {
      if (form.aiProvider === 'groq') {
        // Test Groq
        if (!form.groqApiKey) {
          setAiStatus('fail')
          setAiError('Enter your Groq API key first. Get one free at https://console.groq.com/keys')
          return
        }
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${form.groqApiKey}` },
        })
        if (!resp.ok) {
          if (resp.status === 401) throw new Error('Invalid API key.')
          throw new Error(`HTTP ${resp.status}`)
        }
        const data = await resp.json()
        const models: string[] = (data.data || []).map((m: any) => m.id)
        const hasModel = models.some((n) => n === form.groqModel)
        if (hasModel) {
          setAiStatus('ok')
          setAiError(`Connected. Model "${form.groqModel}" available.`)
        } else {
          setAiStatus('fail')
          setAiError(`Connected but model "${form.groqModel}" not found. Available vision models: ${models.filter((n) => n.includes('vision') || n.includes('scout')).join(', ') || 'check console.groq.com'}`)
        }
      } else if (form.aiProvider === 'gemini') {
        // Test Gemini by listing models
        if (!form.geminiApiKey) {
          setAiStatus('fail')
          setAiError('Enter your Gemini API key first. Get one free at https://aistudio.google.com/apikey')
          return
        }
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${form.geminiModel || 'gemini-2.0-flash'}?key=${form.geminiApiKey}`
        )
        if (!resp.ok) {
          const body = await resp.text()
          if (resp.status === 400 || body.includes('API_KEY_INVALID')) {
            throw new Error('Invalid API key.')
          }
          throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`)
        }
        const data = await resp.json()
        setAiStatus('ok')
        setAiError(`Connected to ${data.displayName || form.geminiModel}. Input token limit: ${data.inputTokenLimit?.toLocaleString() || 'unknown'}.`)
      } else {
        // Test Ollama
        const url = form.ollamaUrl || 'http://127.0.0.1:11434'
        const resp = await fetch(`${url}/api/tags`, { method: 'GET' })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        const models: string[] = (data.models || []).map((m: any) => m.name)
        const hasModel = models.some((n) => n.startsWith(form.ollamaModel))
        if (hasModel) {
          setAiStatus('ok')
          setAiError(`Connected. Found model "${form.ollamaModel}" among ${models.length} model(s).`)
        } else {
          setAiStatus('fail')
          setAiError(`Connected but model "${form.ollamaModel}" not found. Available: ${models.join(', ') || 'none'}. Run: ollama pull ${form.ollamaModel}`)
        }
      }
    } catch (err) {
      setAiStatus('fail')
      setAiError(String(err instanceof Error ? err.message : err))
    }
  }, [form.aiProvider, form.groqApiKey, form.groqModel, form.geminiApiKey, form.geminiModel, form.ollamaUrl, form.ollamaModel])

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
                  <button
                    className="mini-btn"
                    onClick={() => {
                      if (editName.trim()) {
                        updateAccount(acct.id, {
                          name: editName.trim(),
                          capital: parseFloat(editCapital) || 0,
                          description: editDesc.trim() || undefined,
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
              ) : (
                /* Read-only view */
                <>
                  <div className="account-card-info">
                    <div className="account-card-name">
                      {acct.name}
                      {acct.id === activeAccount.id && (
                        <span className="account-card-badge" style={{ marginLeft: 8 }}>Active</span>
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

      {/* ── AI Configuration ─────────────────────────────────── */}
      <section className="card settings-section">
        <h3 className="settings-section-title">AI Configuration</h3>
        <div className="settings-grid" style={{ marginBottom: 20 }}>
          <div className="settings-field">
            <label className="label">Provider</label>
            <div className="settings-theme-toggle">
              <button
                className={`btn-pill ${form.aiProvider === 'groq' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => set('aiProvider', 'groq')}
              >
                Groq
              </button>
              <button
                className={`btn-pill ${form.aiProvider === 'gemini' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => set('aiProvider', 'gemini')}
              >
                Gemini
              </button>
              <button
                className={`btn-pill ${form.aiProvider === 'ollama' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => set('aiProvider', 'ollama')}
              >
                Ollama
              </button>
            </div>
            <span className="settings-hint">
              {form.aiProvider === 'groq'
                ? 'Free, very fast. 30 req/min. Requires API key from console.groq.com'
                : form.aiProvider === 'gemini'
                  ? 'Free, fast, cloud-based. May not be available in all regions.'
                  : 'Local, private, requires GPU. Slower on consumer hardware.'}
            </span>
          </div>
        </div>

        {form.aiProvider === 'groq' && (
          <div className="settings-grid">
            <div className="settings-field">
              <label className="label">API Key</label>
              <input
                type="password"
                placeholder="gsk_..."
                value={form.groqApiKey}
                onChange={(e) => set('groqApiKey', e.target.value)}
              />
              <span className="settings-hint">
                Get a free key at{' '}
                <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  console.groq.com/keys
                </a>
              </span>
            </div>
            <div className="settings-field">
              <label className="label">Model</label>
              <select
                value={form.groqModel}
                onChange={(e) => set('groqModel', e.target.value)}
              >
                <option value="meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B (Recommended)</option>
                <option value="meta-llama/llama-4-maverick-17b-128e-instruct">Llama 4 Maverick 17B</option>
                <option value="llama-3.2-90b-vision-preview">Llama 3.2 90B Vision</option>
                <option value="llama-3.2-11b-vision-preview">Llama 3.2 11B Vision (Fastest)</option>
              </select>
            </div>
          </div>
        )}

        {form.aiProvider === 'gemini' && (
          <div className="settings-grid">
            <div className="settings-field">
              <label className="label">API Key</label>
              <input
                type="password"
                placeholder="AIza..."
                value={form.geminiApiKey}
                onChange={(e) => set('geminiApiKey', e.target.value)}
              />
              <span className="settings-hint">
                Get a free key at{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  aistudio.google.com/apikey
                </a>
              </span>
            </div>
            <div className="settings-field">
              <label className="label">Model</label>
              <select
                value={form.geminiModel}
                onChange={(e) => set('geminiModel', e.target.value)}
              >
                <option value="gemini-2.0-flash">Gemini 2.0 Flash (Recommended)</option>
                <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite (Faster)</option>
              </select>
            </div>
          </div>
        )}

        {form.aiProvider === 'ollama' && (
          <div className="settings-grid">
            <div className="settings-field">
              <label className="label">Ollama URL</label>
              <input
                type="text"
                placeholder="http://127.0.0.1:11434"
                value={form.ollamaUrl}
                onChange={(e) => set('ollamaUrl', e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label className="label">Vision Model</label>
              <input
                type="text"
                placeholder="llava-llama3"
                value={form.ollamaModel}
                onChange={(e) => set('ollamaModel', e.target.value)}
              />
              <span className="settings-hint">e.g. llava-llama3, llava:7b, llava-phi3</span>
            </div>
            <div className="settings-field">
              <label className="label">Timeout (seconds)</label>
              <input
                type="number"
                min={10}
                max={600}
                step={10}
                value={form.ollamaTimeoutSecs}
                onChange={(e) => set('ollamaTimeoutSecs', parseInt(e.target.value) || 180)}
              />
              <span className="settings-hint">180s recommended for GTX 1660 Ti + llava-llama3.</span>
            </div>
          </div>
        )}

        <div className="settings-ai-test">
          <button className="btn-pill btn-secondary" onClick={testAi} disabled={aiStatus === 'testing'}>
            {aiStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
          {aiStatus === 'ok' && <span className="settings-ai-ok">{aiError}</span>}
          {aiStatus === 'fail' && <span className="settings-ai-fail">{aiError}</span>}
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
        {dataNotice && <p className="settings-data-notice">{dataNotice}</p>}
      </section>

      {/* ── App Updates (Tauri only) ────────────────────────── */}
      {isTauri && (
        <section className="card settings-section">
          <h3 className="settings-section-title">App Updates</h3>
          <div className="updater-info">
            <div className="updater-current">
              <span className="updater-label">Current Version</span>
              <span className="updater-version">v0.1.0</span>
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
