import { useState, useMemo, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AiAnalysis, Trade } from '../../shared/types/domain'
import { getApi, loadSettings } from '../../shared/lib/api'
import { SymbolSearch } from '../../shared/components/SymbolSearch'
import { fetchLivePrice } from '../../shared/lib/price'
import { useAccount } from '../../shared/contexts/AccountContext'

const MISTAKE_CATEGORIES = [
  'FOMO', 'Revenge Trade', 'Moved SL', 'No Plan', 'Oversize',
  'Chased Entry', 'Early Exit', 'Held Too Long', 'Wrong Session',
  'Emotional', 'Ignored Rules', 'Poor R:R',
]

function makeEmptyTrade(): Trade {
  const settings = loadSettings()
  return {
    id: '',
    pair: 'EURUSD',
    direction: 'Long',
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    lotSize: 0,
    capital: settings.defaultCapital || 1000,
    enableCommission: settings.defaultCommissionPerLot > 0,
    commissionPerLot: settings.defaultCommissionPerLot || 0,
    riskPercent: settings.defaultRiskPercent || 1,
    pnl: 0,
    returnPercent: 0,
    status: 'Open',
    tags: [],
    mistakes: [],
    setup: '',
    chartImageData: '',
    notesHtml: '',
    openedAt: new Date().toISOString(),
  }
}

/** Detect pip size from pair name. JPY pairs use 0.01, everything else 0.0001 */
function pipSize(pair: string): number {
  return pair.toUpperCase().includes('JPY') ? 0.01 : 0.0001
}

/** Standard forex lot = 100,000 units */
const CONTRACT = 100_000

export function TradesPage() {
  const q = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshKey } = useAccount()
  const editTrade = (location.state as any)?.trade as Trade | undefined

  const [form, setForm] = useState<Trade>(() => editTrade ? { ...editTrade, mistakes: editTrade.mistakes || [] } : makeEmptyTrade())
  const [preview, setPreview] = useState('')
  const [notice, setNotice] = useState('')
  const [ai, setAi] = useState<AiAnalysis | null>(null)
  const [aiError, setAiError] = useState('')
  const [aiElapsed, setAiElapsed] = useState(0)
  const aiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const isEditing = !!form.id

  // If navigated here with a trade to edit, populate the form
  useEffect(() => {
    if (editTrade) {
      setForm({ ...editTrade, mistakes: editTrade.mistakes || [] })
      setPreview('')
      setAi(editTrade.aiAnalysis || null)
      setAiError('')
      setTagInput('')
      // Clear the router state so a refresh doesn't re-populate
      window.history.replaceState({}, '')
    }
  }, [editTrade])

  // Reset form when switching accounts
  useEffect(() => {
    if (!editTrade) {
      resetForm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // ── Auto-calculations ──────────────────────────────────────

  const calc = useMemo(() => {
    const pip = pipSize(form.pair)
    const slDistance = Math.abs(form.entry - form.stopLoss)
    const tpDistance = Math.abs(form.takeProfit - form.entry)
    const slPips = slDistance / pip
    const tpPips = tpDistance / pip
    const riskAmount = form.capital * (form.riskPercent / 100)

    // Lot size: risk amount / (SL pips * pip value per standard lot)
    // Pip value per standard lot = pip * CONTRACT (in quote currency)
    // For simplicity we assume USD account & USD quote, so 1 pip = $10/lot
    const pipValuePerLot = pip * CONTRACT // e.g. 0.0001 * 100000 = $10
    const lotSize = slPips > 0 && pipValuePerLot > 0
      ? riskAmount / (slPips * pipValuePerLot)
      : 0

    // PnL: based on direction & TP distance
    const isLong = form.direction === 'Long'
    const rawPnl = lotSize > 0 && tpDistance > 0
      ? (isLong ? 1 : -1) * (form.takeProfit - form.entry) * lotSize * CONTRACT
      : 0

    // Commission: round-trip (open + close)
    const commission = form.enableCommission
      ? form.commissionPerLot * lotSize * 2
      : 0

    const pnl = rawPnl - commission
    const returnPercent = form.capital > 0 ? (pnl / form.capital) * 100 : 0

    return {
      lotSize: Math.round(lotSize * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      returnPercent: Math.round(returnPercent * 100) / 100,
      riskAmount: Math.round(riskAmount * 100) / 100,
      slPips: Math.round(slPips * 10) / 10,
      tpPips: Math.round(tpPips * 10) / 10,
      commission: Math.round(commission * 100) / 100,
      rr: slPips > 0 ? Math.round((tpPips / slPips) * 100) / 100 : 0,
    }
  }, [form.pair, form.entry, form.stopLoss, form.takeProfit, form.capital, form.riskPercent, form.direction, form.enableCommission, form.commissionPerLot])

  // ── Tag helpers ────────────────────────────────────────────

  const addTag = (value: string) => {
    const tag = value.trim()
    if (!tag || form.tags.includes(tag)) return
    setForm((p) => ({ ...p, tags: [...p.tags, tag] }))
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    setForm((p) => ({ ...p, tags: p.tags.filter((t) => t !== tag) }))
  }

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    }
    if (e.key === 'Backspace' && !tagInput && form.tags.length > 0) {
      removeTag(form.tags[form.tags.length - 1])
    }
  }

  // ── Mistake helpers ────────────────────────────────────────

  const toggleMistake = (m: string) => {
    setForm((p) => ({
      ...p,
      mistakes: p.mistakes.includes(m)
        ? p.mistakes.filter((x) => x !== m)
        : [...p.mistakes, m],
    }))
  }

  // ── Form actions ───────────────────────────────────────────

  const resetForm = () => {
    setForm({ ...makeEmptyTrade(), openedAt: new Date().toISOString() })
    setPreview('')
    setAi(null)
    setAiError('')
    setTagInput('')
  }

  const tradeToSave = (): Trade => ({
    ...form,
    id: form.id || crypto.randomUUID(),
    lotSize: calc.lotSize,
    pnl: calc.pnl,
    returnPercent: calc.returnPercent,
  })

  const save = useMutation({
    mutationFn: () => getApi().saveTrade(tradeToSave()),
    onSuccess: () => {
      q.invalidateQueries({ queryKey: ['trades'] })
      q.invalidateQueries({ queryKey: ['analytics'] })
      if (isEditing) {
        navigate('/')
      } else {
        setNotice('Trade saved successfully')
        resetForm()
        setTimeout(() => setNotice(''), 2500)
      }
    },
    onError: (e) => setNotice(`Error: ${e}`),
  })

  const analyze = useMutation({
    mutationFn: async () => {
      // Start elapsed timer
      setAiElapsed(0)
      aiTimerRef.current = setInterval(() => setAiElapsed((s) => s + 1), 1000)
      const saved = await getApi().saveTrade(tradeToSave())
      setForm(saved)
      return getApi().analyzeTradeImage(saved.id, 'chart')
    },
    onSuccess: async (res) => {
      if (aiTimerRef.current) { clearInterval(aiTimerRef.current); aiTimerRef.current = null }
      setAi(res)
      setAiError('')
      // Persist the AI analysis on the trade
      const updated = { ...form, id: form.id || tradeToSave().id, aiAnalysis: res }
      setForm(updated)
      await getApi().saveTrade(updated)
      q.invalidateQueries({ queryKey: ['trades'] })
    },
    onError: (e) => {
      if (aiTimerRef.current) { clearInterval(aiTimerRef.current); aiTimerRef.current = null }
      setAi(null)
      setAiError(String(e))
    },
  })

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPreview(URL.createObjectURL(f))
    const reader = new FileReader()
    reader.onload = () => setForm((p) => ({ ...p, chartImageData: String(reader.result || '') }))
    reader.readAsDataURL(f)
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <section className="card">
      <h3>{isEditing ? `Edit Trade — ${form.pair}` : 'Log New Trade'}</h3>

      <div className="form-grid">
        {/* Row 1: Pair + Direction */}
        <div className="field">
          <span>Pair</span>
          <SymbolSearch
            value={form.pair}
            onChange={(symbol, result) => {
              setForm((prev) => ({ ...prev, pair: symbol }))
              // Auto-fetch live price when a symbol is selected from dropdown
              if (result) {
                setFetchingPrice(true)
                fetchLivePrice(symbol, result)
                  .then((price) => {
                    if (price !== null) {
                      setForm((prev) => ({ ...prev, entry: price }))
                    }
                  })
                  .finally(() => setFetchingPrice(false))
              }
            }}
            placeholder="Search symbol..."
          />
        </div>
        <label className="field">
          <span>Direction</span>
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
            <option>Long</option>
            <option>Short</option>
          </select>
        </label>

        {/* Row 2: Entry + SL + TP */}
        <label className="field">
          <span>{fetchingPrice ? 'Entry Price (fetching...)' : 'Entry Price'}</span>
          <input type="number" step="any" value={form.entry || ''} onChange={(e) => setForm({ ...form, entry: Number(e.target.value) })} placeholder="0.00000" />
        </label>
        <label className="field">
          <span>Stop Loss</span>
          <input type="number" step="any" value={form.stopLoss || ''} onChange={(e) => setForm({ ...form, stopLoss: Number(e.target.value) })} placeholder="0.00000" />
        </label>
        <label className="field">
          <span>Take Profit</span>
          <input type="number" step="any" value={form.takeProfit || ''} onChange={(e) => setForm({ ...form, takeProfit: Number(e.target.value) })} placeholder="0.00000" />
        </label>

        {/* Row 3: Capital + Risk */}
        <label className="field">
          <span>Capital ($)</span>
          <input type="number" step="any" value={form.capital || ''} onChange={(e) => setForm({ ...form, capital: Number(e.target.value) })} placeholder="1000" />
        </label>
        <label className="field">
          <span>Risk %</span>
          <input type="number" step="any" value={form.riskPercent || ''} onChange={(e) => setForm({ ...form, riskPercent: Number(e.target.value) })} placeholder="1" />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option>Open</option>
            <option>Closed</option>
          </select>
        </label>

        {/* Row 4: Date */}
        <label className="field">
          <span>Date</span>
          <input type="datetime-local" value={form.openedAt.slice(0, 16)} onChange={(e) => setForm({ ...form, openedAt: new Date(e.target.value).toISOString() })} />
        </label>

        {/* Commission toggle */}
        <div className="field">
          <span>Commission</span>
          <div className="toggle-row">
            <button
              type="button"
              className={`toggle-btn ${form.enableCommission ? 'toggle-on' : ''}`}
              onClick={() => setForm({ ...form, enableCommission: !form.enableCommission })}
            >
              <span className="toggle-thumb" />
            </button>
            {form.enableCommission && (
              <input
                type="number"
                step="any"
                value={form.commissionPerLot || ''}
                onChange={(e) => setForm({ ...form, commissionPerLot: Number(e.target.value) })}
                placeholder="$ per lot"
                style={{ flex: 1 }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Auto-calculated summary */}
      {(calc.lotSize > 0 || calc.pnl !== 0) && (
        <div className="calc-summary">
          <div className="calc-item">
            <span className="calc-label">Lot Size</span>
            <span className="calc-value">{calc.lotSize}</span>
          </div>
          <div className="calc-item">
            <span className="calc-label">SL Pips</span>
            <span className="calc-value">{calc.slPips}</span>
          </div>
          <div className="calc-item">
            <span className="calc-label">TP Pips</span>
            <span className="calc-value">{calc.tpPips}</span>
          </div>
          <div className="calc-item">
            <span className="calc-label">R:R</span>
            <span className="calc-value">{calc.rr}</span>
          </div>
          <div className="calc-item">
            <span className="calc-label">Risk ($)</span>
            <span className="calc-value">${calc.riskAmount}</span>
          </div>
          <div className="calc-item">
            <span className="calc-label">PnL</span>
            <span className={`calc-value ${calc.pnl >= 0 ? 'positive' : 'negative'}`}>${calc.pnl}</span>
          </div>
          {form.enableCommission && calc.commission > 0 && (
            <div className="calc-item">
              <span className="calc-label">Commission</span>
              <span className="calc-value" style={{ color: 'var(--negative)' }}>-${calc.commission}</span>
            </div>
          )}
          <div className="calc-item">
            <span className="calc-label">Return</span>
            <span className={`calc-value ${calc.returnPercent >= 0 ? 'positive' : 'negative'}`}>{calc.returnPercent}%</span>
          </div>
        </div>
      )}

      {/* Setup Tags */}
      <div className="field field-wide" style={{ marginTop: 14 }}>
        <span>Setup Tags</span>
        <div className="tags-input-container">
          {form.tags.map((tag) => (
            <span key={tag} className="tag-pill">
              {tag}
              <button type="button" className="tag-remove" onClick={() => removeTag(tag)}>&times;</button>
            </span>
          ))}
          <input
            className="tags-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => addTag(tagInput)}
            placeholder={form.tags.length === 0 ? 'e.g. Break & Retest, FVG, OB (press Enter)' : 'Add tag...'}
          />
        </div>
      </div>

      {/* Mistakes */}
      <div className="field field-wide" style={{ marginTop: 14 }}>
        <span>Mistakes (if any)</span>
        <div className="mistakes-grid">
          {MISTAKE_CATEGORIES.map((m) => (
            <button
              key={m}
              type="button"
              className={`mistake-pill ${form.mistakes.includes(m) ? 'active' : ''}`}
              onClick={() => toggleMistake(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="field field-wide" style={{ marginTop: 12 }}>
        <span>Notes</span>
        <textarea rows={3} value={form.notesHtml} onChange={(e) => setForm({ ...form, notesHtml: e.target.value })} placeholder="Trade notes, reasoning, lessons learned..." />
      </div>

      {/* Chart upload */}
      <div className="field field-wide" style={{ marginTop: 12 }}>
        <span>Upload Chart Screenshot</span>
        <input type="file" accept="image/*" onChange={handleFileUpload} />
      </div>

      {preview && <img src={preview} className="chart-preview-img" alt="Chart preview" />}
      {form.chartImageData && !preview && (
        <img src={form.chartImageData} className="chart-preview-img" alt="Saved chart" />
      )}

      <div className="actions-row">
        <button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving...' : 'Save Trade'}
        </button>
        <button onClick={() => analyze.mutate()} disabled={!form.chartImageData || analyze.isPending}>
          {analyze.isPending ? `Analyzing... (${aiElapsed}s)` : 'Analyze with AI'}
        </button>
        <button onClick={resetForm}>Clear</button>
      </div>

      {notice && <div className="save-toast">{notice}</div>}
      {aiError && <div className="analysis-card analysis-error">{aiError}</div>}
      {ai && (
        <div className="analysis-card">
          <h4 className="analysis-title">AI Analysis</h4>
          <div className="analysis-field">
            <span className="label">Summary</span>
            <p>{ai.summary}</p>
          </div>
          {ai.setupClassification && ai.setupClassification !== 'unknown' && (
            <div className="analysis-field">
              <span className="label">Setup</span>
              <p>{ai.setupClassification}</p>
            </div>
          )}
          {ai.riskFeedback && (
            <div className="analysis-field">
              <span className="label">Risk & Recommendations</span>
              <p>{ai.riskFeedback}</p>
            </div>
          )}
          {ai.mistakes.length > 0 && (
            <div className="analysis-field">
              <span className="label">Potential Mistakes</span>
              <ul className="analysis-mistakes-list">
                {ai.mistakes.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          <div className="analysis-meta">
            <span className="muted">Confidence: {Math.round(ai.confidence * 100)}%</span>
          </div>
        </div>
      )}
    </section>
  )
}
