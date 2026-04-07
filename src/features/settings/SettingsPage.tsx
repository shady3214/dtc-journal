import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, ThemeName } from '../../shared/types/domain'
import { getApi, loadSettings } from '../../shared/lib/api'
import { exportAllToExcel } from '../../shared/lib/excel'

const THEMES: { id: ThemeName; color: string; label: string }[] = [
  { id: 'obsidian', color: '#22c55e', label: 'Obsidian' },
  { id: 'midnight', color: '#3b82f6', label: 'Midnight' },
  { id: 'ember', color: '#f59e0b', label: 'Ember' },
  { id: 'crimson', color: '#f43f5e', label: 'Crimson' },
  { id: 'phantom', color: '#a855f7', label: 'Phantom' },
]

export function SettingsPage() {
  const [form, setForm] = useState<AppSettings>(() => loadSettings())
  const [saved, setSaved] = useState(false)
  const [aiStatus, setAiStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [aiError, setAiError] = useState('')
  const [confirmAction, setConfirmAction] = useState<string | null>(null)
  const [dataNotice, setDataNotice] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Persist on save
  const save = useCallback(async () => {
    await getApi().saveSettings(form)
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
        <div className="settings-grid">
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
          <div className="settings-field">
            <label className="label">Starting Capital ($)</label>
            <input
              type="number"
              min={0}
              step={100}
              value={form.startingCapital || ''}
              onChange={(e) => set('startingCapital', parseFloat(e.target.value) || 0)}
            />
            <span className="settings-hint">Used for the equity curve baseline on the dashboard.</span>
          </div>
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
