import { useState, useId } from 'react'

// ── Contract reference data ────────────────────────────────────────

interface ContractSpec {
  name: string
  symbol: string
  tickSize: number
  tickValue: number
  pointValue: number
  exchange: string
}

const CONTRACT_GROUPS: { label: string; contracts: ContractSpec[] }[] = [
  {
    label: 'Equity Indices',
    contracts: [
      { name: 'E-mini S&P 500',           symbol: 'ES',  tickSize: 0.25,      tickValue: 12.5,     pointValue: 50,         exchange: 'CME'   },
      { name: 'Micro E-mini S&P 500',     symbol: 'MES', tickSize: 0.25,      tickValue: 1.25,     pointValue: 5,          exchange: 'CME'   },
      { name: 'E-mini Nasdaq-100',        symbol: 'NQ',  tickSize: 0.25,      tickValue: 5,        pointValue: 20,         exchange: 'CME'   },
      { name: 'Micro E-mini Nasdaq-100',  symbol: 'MNQ', tickSize: 0.25,      tickValue: 0.5,      pointValue: 2,          exchange: 'CME'   },
      { name: 'E-mini Dow',               symbol: 'YM',  tickSize: 1,         tickValue: 5,        pointValue: 5,          exchange: 'CBOT'  },
      { name: 'Micro E-mini Dow',         symbol: 'MYM', tickSize: 1,         tickValue: 0.5,      pointValue: 0.5,        exchange: 'CBOT'  },
      { name: 'E-mini Russell 2000',      symbol: 'RTY', tickSize: 0.1,       tickValue: 5,        pointValue: 50,         exchange: 'CME'   },
      { name: 'Micro E-mini Russell 2000',symbol: 'M2K', tickSize: 0.1,       tickValue: 0.5,      pointValue: 5,          exchange: 'CME'   },
    ],
  },
  {
    label: 'Energy',
    contracts: [
      { name: 'Crude Oil (WTI)',  symbol: 'CL',  tickSize: 0.01,  tickValue: 10,    pointValue: 1000,    exchange: 'NYMEX' },
      { name: 'Micro Crude Oil', symbol: 'MCL', tickSize: 0.01,  tickValue: 1,     pointValue: 100,     exchange: 'NYMEX' },
      { name: 'Natural Gas',     symbol: 'NG',  tickSize: 0.001, tickValue: 10,    pointValue: 10000,   exchange: 'NYMEX' },
    ],
  },
  {
    label: 'Metals',
    contracts: [
      { name: 'Gold',       symbol: 'GC',  tickSize: 0.1,    tickValue: 10,    pointValue: 100,     exchange: 'COMEX' },
      { name: 'Micro Gold', symbol: 'MGC', tickSize: 0.1,    tickValue: 1,     pointValue: 10,      exchange: 'COMEX' },
      { name: 'Silver',     symbol: 'SI',  tickSize: 0.005,  tickValue: 25,    pointValue: 5000,    exchange: 'COMEX' },
      { name: 'Copper',     symbol: 'HG',  tickSize: 0.0005, tickValue: 12.5,  pointValue: 25000,   exchange: 'COMEX' },
    ],
  },
  {
    label: 'Treasuries',
    contracts: [
      { name: '30-Year T-Bond',  symbol: 'ZB', tickSize: 1 / 32,  tickValue: 31.25,   pointValue: 1000, exchange: 'CBOT' },
      { name: '10-Year T-Note',  symbol: 'ZN', tickSize: 1 / 64,  tickValue: 15.625,  pointValue: 1000, exchange: 'CBOT' },
      { name: '5-Year T-Note',   symbol: 'ZF', tickSize: 1 / 128, tickValue: 7.8125,  pointValue: 1000, exchange: 'CBOT' },
    ],
  },
  {
    label: 'Currencies',
    contracts: [
      { name: 'Euro FX',          symbol: '6E', tickSize: 0.00005,    tickValue: 6.25,  pointValue: 125000,     exchange: 'CME' },
      { name: 'Japanese Yen',     symbol: '6J', tickSize: 0.0000005,  tickValue: 6.25,  pointValue: 12500000,   exchange: 'CME' },
      { name: 'British Pound',    symbol: '6B', tickSize: 0.0001,     tickValue: 6.25,  pointValue: 62500,      exchange: 'CME' },
      { name: 'Australian Dollar',symbol: '6A', tickSize: 0.0001,     tickValue: 10,    pointValue: 100000,     exchange: 'CME' },
    ],
  },
  {
    label: 'Agriculture',
    contracts: [
      { name: 'Corn',     symbol: 'ZC', tickSize: 0.25, tickValue: 12.5, pointValue: 50, exchange: 'CBOT' },
      { name: 'Soybeans', symbol: 'ZS', tickSize: 0.25, tickValue: 12.5, pointValue: 50, exchange: 'CBOT' },
      { name: 'Wheat',    symbol: 'ZW', tickSize: 0.25, tickValue: 12.5, pointValue: 50, exchange: 'CBOT' },
    ],
  },
  {
    label: 'Crypto',
    contracts: [
      { name: 'Bitcoin (CME)',  symbol: 'BTC', tickSize: 5,    tickValue: 25,   pointValue: 5,    exchange: 'CME' },
      { name: 'Micro Bitcoin',  symbol: 'MBT', tickSize: 5,    tickValue: 0.5,  pointValue: 0.1,  exchange: 'CME' },
      { name: 'Ether (CME)',    symbol: 'ETH', tickSize: 0.25, tickValue: 12.5, pointValue: 50,   exchange: 'CME' },
    ],
  },
]

const ALL_CONTRACTS = CONTRACT_GROUPS.flatMap((g) => g.contracts)

// preset list shown in dropdown (popular ones first)
const PRESET_OPTIONS = [
  'ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K',
  'CL', 'MCL', 'NG',
  'GC', 'MGC', 'SI',
  'ZB', 'ZN', 'ZF',
  '6E', '6B', '6J', '6A',
  'ZC', 'ZS', 'ZW',
  'BTC', 'MBT', 'ETH',
]

function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toString()
  // Show up to 8 significant decimal digits but trim trailing zeros
  return parseFloat(n.toPrecision(8)).toString()
}

// ── Consistency Rule Simulator ─────────────────────────────────────

function ConsistencySimulator() {
  const [accountSize, setAccountSize] = useState('100000')
  const [profitTargetPct, setProfitTargetPct] = useState('10')
  const [bestDayProfit, setBestDayProfit] = useState('3000')
  const [consistencyPct, setConsistencyPct] = useState('35')
  const [result, setResult] = useState<null | { pass: boolean; ratio: number; allowedMax: number; targetAmount: number }>(null)

  const calculate = () => {
    const acct = parseFloat(accountSize) || 0
    const tgt  = parseFloat(profitTargetPct) || 0
    const best = parseFloat(bestDayProfit) || 0
    const rule = parseFloat(consistencyPct) || 0

    const targetAmount = acct * (tgt / 100)
    const allowedMax   = targetAmount * (rule / 100)
    const ratio        = targetAmount > 0 ? (best / targetAmount) * 100 : 0
    const pass         = best <= allowedMax

    setResult({ pass, ratio, allowedMax, targetAmount })
  }

  return (
    <div className="tool-card card">
      <div className="tool-card-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <h2 className="tool-card-title">Consistency Rule Simulator</h2>
      </div>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Validate whether your best trading day stays within your prop firm's consistency limit.
      </p>

      <div className="tool-fields">
        <div className="tool-field">
          <label>Account Size ($)</label>
          <input type="number" min={0} step={1000} value={accountSize}
            onChange={(e) => setAccountSize(e.target.value)} placeholder="e.g. 100000" />
        </div>
        <div className="tool-field">
          <label>Profit Target (%)</label>
          <input type="number" min={0} max={100} step={0.5} value={profitTargetPct}
            onChange={(e) => setProfitTargetPct(e.target.value)} placeholder="e.g. 10" />
        </div>
        <div className="tool-field">
          <label>Best Trading Day Profit ($)</label>
          <input type="number" min={0} step={100} value={bestDayProfit}
            onChange={(e) => setBestDayProfit(e.target.value)} placeholder="e.g. 3000" />
        </div>
        <div className="tool-field">
          <label>Consistency Score (%)</label>
          <input type="number" min={0} max={100} step={1} value={consistencyPct}
            onChange={(e) => setConsistencyPct(e.target.value)} placeholder="e.g. 35" />
          <span className="tool-field-hint">No single day can exceed this % of the profit target</span>
        </div>
      </div>

      <button className="btn-primary tool-calc-btn" onClick={calculate}>
        Calculate Consistency
      </button>

      {result && (
        <div className={`tool-result ${result.pass ? 'tool-result-pass' : 'tool-result-fail'}`}>
          <div className="tool-result-badge">
            {result.pass ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                CONSISTENT — Rule Passed
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                INCONSISTENT — Rule Violated
              </>
            )}
          </div>
          <div className="tool-result-rows">
            <div className="tool-result-row">
              <span>Profit target amount</span>
              <span>${result.targetAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="tool-result-row">
              <span>Max allowed best day</span>
              <span>${result.allowedMax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="tool-result-row">
              <span>Your best day as % of target</span>
              <span style={{ color: result.pass ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
                {result.ratio.toFixed(1)}% {result.pass ? `(limit ${consistencyPct}%)` : `(exceeds ${consistencyPct}% limit)`}
              </span>
            </div>
          </div>
          {!result.pass && (
            <p className="tool-result-note">
              Your best day of ${parseFloat(bestDayProfit).toLocaleString()} exceeds the ${result.allowedMax.toLocaleString(undefined, { maximumFractionDigits: 2 })} limit.
              Reduce your best day profit to stay within the consistency rule.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Futures Position Size Calculator ──────────────────────────────

function PositionSizeCalculator() {
  const [preset, setPreset] = useState('')
  const [dollarPerPoint, setDollarPerPoint] = useState('')
  const [balance, setBalance] = useState('')
  const [riskMode, setRiskMode] = useState<'percent' | 'dollar'>('percent')
  const [riskPct, setRiskPct] = useState('1')
  const [riskDollar, setRiskDollar] = useState('')
  const [stopPoints, setStopPoints] = useState('')
  const [stopTicks, setStopTicks] = useState('')
  const [tickSize, setTickSize] = useState('')
  const [showRefTable, setShowRefTable] = useState(false)
  const [result, setResult] = useState<null | {
    contracts: number
    riskAmount: number
    riskPerContract: number
    effectiveStop: number
  }>(null)
  const [copied, setCopied] = useState(false)
  const ticksId = useId()

  const handlePreset = (sym: string) => {
    setPreset(sym)
    if (!sym) return
    const spec = ALL_CONTRACTS.find((c) => c.symbol === sym)
    if (spec) {
      setDollarPerPoint(spec.pointValue.toString())
      setTickSize(fmt(spec.tickSize))
    }
  }

  // Auto-fill stop points from ticks when both tick fields are filled
  const handleTicksChange = (ticks: string, tSizeOverride?: string) => {
    setStopTicks(ticks)
    const t = parseFloat(ticks)
    const s = parseFloat(tSizeOverride ?? tickSize)
    if (!isNaN(t) && !isNaN(s) && s > 0) {
      setStopPoints(fmt(t * s))
    }
  }

  const handleTickSizeChange = (ts: string) => {
    setTickSize(ts)
    const t = parseFloat(stopTicks)
    const s = parseFloat(ts)
    if (!isNaN(t) && !isNaN(s) && s > 0) {
      setStopPoints(fmt(t * s))
    }
  }

  const calculate = () => {
    const dpp  = parseFloat(dollarPerPoint)
    const bal  = parseFloat(balance)
    const stop = parseFloat(stopPoints)
    if (!dpp || !bal || !stop) return

    const riskAmt = riskMode === 'percent'
      ? bal * (parseFloat(riskPct) / 100)
      : parseFloat(riskDollar)
    if (!riskAmt || riskAmt <= 0) return

    const riskPerContract = stop * dpp
    const contracts = riskPerContract > 0 ? Math.floor(riskAmt / riskPerContract) : 0

    setResult({ contracts, riskAmount: riskAmt, riskPerContract, effectiveStop: stop })
  }

  const reset = () => {
    setPreset(''); setDollarPerPoint(''); setBalance('')
    setRiskPct('1'); setRiskDollar(''); setStopPoints('')
    setStopTicks(''); setTickSize(''); setResult(null)
  }

  const copyResults = () => {
    if (!result) return
    const text = [
      `Contracts: ${result.contracts}`,
      `Risk Amount: $${result.riskAmount.toFixed(2)}`,
      `Risk per Contract: $${result.riskPerContract.toFixed(2)}`,
      `Stop Distance: ${result.effectiveStop} pts`,
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="tool-card card">
      <div className="tool-card-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <h2 className="tool-card-title">Futures Position Size Calculator</h2>
      </div>
      <p className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
        Calculate how many contracts to trade based on your risk and stop distance. No live data used.
      </p>

      <div className="tool-grid-2">
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="tool-field">
            <label>Contract preset</label>
            <select value={preset} onChange={(e) => handlePreset(e.target.value)}>
              <option value="">Select contract</option>
              {PRESET_OPTIONS.map((sym) => {
                const spec = ALL_CONTRACTS.find((c) => c.symbol === sym)
                return spec ? (
                  <option key={sym} value={sym}>{sym} {spec.name}</option>
                ) : null
              })}
            </select>
          </div>

          <div className="tool-field">
            <label>Account balance ($)</label>
            <input type="number" min={0} step={1000} value={balance}
              onChange={(e) => setBalance(e.target.value)} placeholder="e.g., 50000" />
          </div>

          <div className="tool-field">
            <label>Stop distance (points)</label>
            <input type="number" min={0} step={0.25} value={stopPoints}
              onChange={(e) => setStopPoints(e.target.value)} placeholder="e.g., 2.50" />
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="tool-field">
            <label>Dollar per point per contract</label>
            <input type="number" min={0} step={1} value={dollarPerPoint}
              onChange={(e) => setDollarPerPoint(e.target.value)} placeholder="e.g., 50 for ES" />
          </div>

          <div className="tool-field">
            <label>Risk setting</label>
            <div className="tool-radio-group">
              <label className={`tool-radio ${riskMode === 'percent' ? 'active' : ''}`}>
                <input type="radio" name="riskMode" value="percent"
                  checked={riskMode === 'percent'} onChange={() => setRiskMode('percent')} />
                Percent
              </label>
              <label className={`tool-radio ${riskMode === 'dollar' ? 'active' : ''}`}>
                <input type="radio" name="riskMode" value="dollar"
                  checked={riskMode === 'dollar'} onChange={() => setRiskMode('dollar')} />
                Dollar
              </label>
            </div>
            {riskMode === 'percent' ? (
              <input type="number" min={0} max={100} step={0.1} value={riskPct}
                onChange={(e) => setRiskPct(e.target.value)} placeholder="Risk % of balance, e.g., 1" />
            ) : (
              <input type="number" min={0} step={100} value={riskDollar}
                onChange={(e) => setRiskDollar(e.target.value)} placeholder="Fixed risk amount, e.g., 500" />
            )}
          </div>

          <div className="tool-field">
            <label htmlFor={ticksId}>Or enter stop in ticks</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id={ticksId} type="number" min={0} step={1} value={stopTicks}
                onChange={(e) => handleTicksChange(e.target.value)}
                placeholder="e.g., 10" style={{ flex: 1 }} />
              <input type="number" min={0} step={0.01} value={tickSize}
                onChange={(e) => handleTickSizeChange(e.target.value)}
                placeholder="Tick size" style={{ flex: 1 }} />
            </div>
            <span className="tool-field-hint">Ticks × tick size auto-fills stop distance above</span>
          </div>
        </div>
      </div>

      <div className="tool-action-row">
        <button className="btn-primary tool-calc-btn" onClick={calculate}>Calculate</button>
        <button className="btn-secondary tool-calc-btn" onClick={copyResults} disabled={!result}>
          {copied ? '✓ Copied' : 'Copy results'}
        </button>
        <button className="btn-secondary tool-calc-btn" onClick={reset}>Reset</button>
      </div>

      {result && (
        <div className="tool-result tool-result-neutral">
          <div className="tool-result-main">
            <span className="tool-result-contracts-label">Contracts to trade</span>
            <span className="tool-result-contracts-value">{result.contracts}</span>
          </div>
          <div className="tool-result-rows">
            <div className="tool-result-row">
              <span>Risk amount</span>
              <span>${result.riskAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="tool-result-row">
              <span>Risk per contract</span>
              <span>${result.riskPerContract.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="tool-result-row">
              <span>Stop distance</span>
              <span>{result.effectiveStop} pts</span>
            </div>
            {result.contracts === 0 && (
              <p className="tool-result-note" style={{ color: 'var(--negative)' }}>
                Risk is too small relative to stop size — 0 contracts. Increase balance, raise risk %, or tighten your stop.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Dollar per point reference */}
      <button
        className="tool-collapse-btn"
        onClick={() => setShowRefTable((v) => !v)}
      >
        <span>Futures Contract Quick Reference</span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: showRefTable ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {showRefTable && (
        <div className="tool-ref-table-wrap">
          <table className="tool-ref-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Symbol</th>
                <th>Tick Size</th>
                <th>Tick Value</th>
                <th>Point Value</th>
                <th>Exchange</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACT_GROUPS.map((group) => (
                <>
                  <tr key={group.label} className="tool-ref-group-row">
                    <td colSpan={6}>{group.label}</td>
                  </tr>
                  {group.contracts.map((c) => (
                    <tr
                      key={c.symbol}
                      className={`tool-ref-row ${preset === c.symbol ? 'tool-ref-row-active' : ''}`}
                      onClick={() => handlePreset(c.symbol)}
                      title="Click to use this contract"
                    >
                      <td>{c.name}</td>
                      <td><strong>{c.symbol}</strong></td>
                      <td>{fmt(c.tickSize)}</td>
                      <td>${c.tickValue.toLocaleString()}</td>
                      <td>${c.pointValue.toLocaleString()}</td>
                      <td>{c.exchange}</td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            Educational use only. Commissions, fees, and slippage not included. Not investment advice.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────

type Tool = 'position-size' | 'consistency'

export function ToolsPage() {
  const [active, setActive] = useState<Tool>('position-size')

  return (
    <div className="tools-page">
      <div className="tools-tab-bar">
        <button
          className={`tools-tab ${active === 'position-size' ? 'active' : ''}`}
          onClick={() => setActive('position-size')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          Position Size
        </button>
        <button
          className={`tools-tab ${active === 'consistency' ? 'active' : ''}`}
          onClick={() => setActive('consistency')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Consistency Simulator
        </button>
      </div>

      {active === 'position-size' && <PositionSizeCalculator />}
      {active === 'consistency'   && <ConsistencySimulator />}
    </div>
  )
}
