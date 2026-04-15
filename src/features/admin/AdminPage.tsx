import { useCallback, useState } from 'react'
import type { AppSettings } from '../../shared/types/domain'
import { getApi, loadSettings, persistSettings } from '../../shared/lib/api'

export function AdminPage() {
  const adminMode = localStorage.getItem('journal_admin_mode') === '1'
  const [form, setForm] = useState<AppSettings>(() => loadSettings())
  const [saved, setSaved] = useState(false)
  const [aiStatus, setAiStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [aiError, setAiError] = useState('')

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const save = useCallback(async () => {
    await getApi().saveSettings(form)
    persistSettings(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [form])

  const testAi = useCallback(async () => {
    setAiStatus('testing')
    setAiError('')
    try {
      if (form.aiProvider === 'groq') {
        if (!form.groqApiKey) throw new Error('Enter Groq API key first.')
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${form.groqApiKey}` },
        })
        if (!resp.ok) throw new Error(resp.status === 401 ? 'Invalid Groq API key.' : `Groq HTTP ${resp.status}`)
        setAiStatus('ok')
        setAiError('Groq connection successful.')
      } else if (form.aiProvider === 'gemini') {
        if (!form.geminiApiKey) throw new Error('Enter Gemini API key first.')
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${form.geminiModel || 'gemini-2.0-flash'}?key=${form.geminiApiKey}`)
        if (!resp.ok) throw new Error(resp.status === 400 ? 'Invalid Gemini API key.' : `Gemini HTTP ${resp.status}`)
        setAiStatus('ok')
        setAiError('Gemini connection successful.')
      } else {
        const url = form.ollamaUrl || 'http://127.0.0.1:11434'
        const resp = await fetch(`${url}/api/tags`, { method: 'GET' })
        if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`)
        setAiStatus('ok')
        setAiError('Ollama connection successful.')
      }
    } catch (err) {
      setAiStatus('fail')
      setAiError(String(err instanceof Error ? err.message : err))
    }
  }, [form])

  if (!adminMode) {
    return (
      <section className="card settings-section">
        <h3 className="settings-section-title">Admin</h3>
        <p className="muted">Admin mode is disabled for this user.</p>
      </section>
    )
  }

  return (
    <div className="settings-page">
      <section className="card settings-section">
        <h3 className="settings-section-title">Admin</h3>
        <p className="muted">Admin-only controls for AI providers and models.</p>
      </section>

      <section className="card settings-section">
        <h3 className="settings-section-title">AI Configuration</h3>
        <div className="settings-grid" style={{ marginBottom: 20 }}>
          <div className="settings-field">
            <label className="label">Provider</label>
            <div className="settings-theme-toggle">
              <button className={`btn-pill ${form.aiProvider === 'groq' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set('aiProvider', 'groq')}>Groq</button>
              <button className={`btn-pill ${form.aiProvider === 'gemini' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set('aiProvider', 'gemini')}>Gemini</button>
              <button className={`btn-pill ${form.aiProvider === 'ollama' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set('aiProvider', 'ollama')}>Ollama</button>
            </div>
          </div>
        </div>

        {form.aiProvider === 'groq' && (
          <div className="settings-grid">
            <div className="settings-field">
              <label className="label">API Key</label>
              <input type="password" placeholder="gsk_..." value={form.groqApiKey} onChange={(e) => set('groqApiKey', e.target.value)} />
            </div>
            <div className="settings-field">
              <label className="label">Model</label>
              <select value={form.groqModel} onChange={(e) => set('groqModel', e.target.value)}>
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
              <input type="password" placeholder="AIza..." value={form.geminiApiKey} onChange={(e) => set('geminiApiKey', e.target.value)} />
            </div>
            <div className="settings-field">
              <label className="label">Model</label>
              <select value={form.geminiModel} onChange={(e) => set('geminiModel', e.target.value)}>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
              </select>
            </div>
          </div>
        )}

        {form.aiProvider === 'ollama' && (
          <div className="settings-grid">
            <div className="settings-field">
              <label className="label">Ollama URL</label>
              <input type="text" placeholder="http://127.0.0.1:11434" value={form.ollamaUrl} onChange={(e) => set('ollamaUrl', e.target.value)} />
            </div>
            <div className="settings-field">
              <label className="label">Vision Model</label>
              <input type="text" placeholder="llava-llama3" value={form.ollamaModel} onChange={(e) => set('ollamaModel', e.target.value)} />
            </div>
            <div className="settings-field">
              <label className="label">Timeout (seconds)</label>
              <input type="number" min={10} max={600} step={10} value={form.ollamaTimeoutSecs} onChange={(e) => set('ollamaTimeoutSecs', parseInt(e.target.value) || 180)} />
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

      <div className="settings-save-bar">
        <button className="btn-pill btn-primary" onClick={save}>Save Admin Settings</button>
        {saved && <span className="settings-saved-badge">Saved</span>}
      </div>
    </div>
  )
}
