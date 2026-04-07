import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { getApi } from '../../shared/lib/api'
import { exportAllToExcel } from '../../shared/lib/excel'
import type { Trade } from '../../shared/types/domain'
import { useAccount } from '../../shared/contexts/AccountContext'

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number) => n.toFixed(1) + '%'

interface GroupStats {
  key: string
  trades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  avgPnl: number
  bestTrade: number
  worstTrade: number
}

function groupBy(trades: Trade[], keyFn: (t: Trade) => string): GroupStats[] {
  const map = new Map<string, Trade[]>()
  for (const t of trades) {
    const k = keyFn(t)
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(t)
  }
  return Array.from(map, ([key, list]) => {
    const wins = list.filter((t) => t.pnl > 0).length
    const totalPnl = list.reduce((s, t) => s + t.pnl, 0)
    const pnls = list.map((t) => t.pnl)
    return {
      key,
      trades: list.length,
      wins,
      losses: list.length - wins,
      winRate: list.length ? (wins / list.length) * 100 : 0,
      totalPnl,
      avgPnl: list.length ? totalPnl / list.length : 0,
      bestTrade: Math.max(...pnls),
      worstTrade: Math.min(...pnls),
    }
  }).sort((a, b) => b.totalPnl - a.totalPnl)
}

function getSession(hour: number): string {
  if (hour < 8) return 'Asian'
  if (hour < 16) return 'London'
  return 'New York'
}

function getDayName(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]
}

/* ── Performance Table Component ──────────────────────────── */

function PerfTable({ title, data, maxPnl }: { title: string; data: GroupStats[]; maxPnl: number }) {
  if (data.length === 0) return null
  return (
    <div className="card analytics-section">
      <h3>{title}</h3>
      <div className="perf-table-scroll">
        <table className="perf-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Trades</th>
              <th>Win Rate</th>
              <th>Total PnL</th>
              <th style={{ width: '20%' }}>PnL</th>
              <th>Avg PnL</th>
              <th>Best</th>
              <th>Worst</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td><strong>{d.key}</strong></td>
                <td>{d.trades}</td>
                <td>{pct(d.winRate)}</td>
                <td className={d.totalPnl >= 0 ? 'positive' : 'negative'}>{fmt(d.totalPnl)}</td>
                <td>
                  <div className="perf-bar-track">
                    <div
                      className={`perf-bar-fill ${d.totalPnl >= 0 ? 'pos' : 'neg'}`}
                      style={{ width: `${maxPnl > 0 ? Math.min(100, (Math.abs(d.totalPnl) / maxPnl) * 100) : 0}%` }}
                    />
                  </div>
                </td>
                <td className={d.avgPnl >= 0 ? 'positive' : 'negative'}>{fmt(d.avgPnl)}</td>
                <td className="positive">{fmt(d.bestTrade)}</td>
                <td className="negative">{fmt(d.worstTrade)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Streak Tracker ────────────────────────────────────────── */

function StreakTracker({ trades }: { trades: Trade[] }) {
  const sorted = [...trades].sort((a, b) => a.openedAt.localeCompare(b.openedAt))

  let currentStreak = 0, currentType = ''
  let maxWinStreak = 0, maxLossStreak = 0
  let tempWin = 0, tempLoss = 0
  let maxDrawdown = 0, runningDD = 0

  for (const t of sorted) {
    const isWin = t.pnl > 0
    if (isWin) {
      tempWin++
      tempLoss = 0
      maxWinStreak = Math.max(maxWinStreak, tempWin)
      runningDD = 0
    } else {
      tempLoss++
      tempWin = 0
      maxLossStreak = Math.max(maxLossStreak, tempLoss)
      runningDD += Math.abs(t.pnl)
      maxDrawdown = Math.max(maxDrawdown, runningDD)
    }
  }

  // Current streak
  for (let i = sorted.length - 1; i >= 0; i--) {
    const isWin = sorted[i].pnl > 0
    const type = isWin ? 'Win' : 'Loss'
    if (i === sorted.length - 1) {
      currentType = type
      currentStreak = 1
    } else if (type === currentType) {
      currentStreak++
    } else {
      break
    }
  }

  return (
    <div className="card analytics-section">
      <h3>Streak Tracker</h3>
      {sorted.length === 0 ? (
        <p className="muted" style={{ padding: '20px 0', textAlign: 'center' }}>No trades yet.</p>
      ) : (
        <div className="streak-grid">
          <div className="streak-item">
            <span className="streak-label">Current Streak</span>
            <span className={`streak-value ${currentType === 'Win' ? 'positive' : 'negative'}`}>
              {currentStreak} {currentType}{currentStreak !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="streak-item">
            <span className="streak-label">Max Win Streak</span>
            <span className="streak-value positive">{maxWinStreak}</span>
          </div>
          <div className="streak-item">
            <span className="streak-label">Max Loss Streak</span>
            <span className="streak-value negative">{maxLossStreak}</span>
          </div>
          <div className="streak-item">
            <span className="streak-label">Max Consecutive Loss</span>
            <span className="streak-value negative">{fmt(maxDrawdown)}</span>
          </div>
          <div className="streak-item">
            <span className="streak-label">Total Trades</span>
            <span className="streak-value">{sorted.length}</span>
          </div>
          <div className="streak-item">
            <span className="streak-label">Profit Factor</span>
            <span className="streak-value">
              {(() => {
                const grossWin = sorted.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
                const grossLoss = Math.abs(sorted.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
                return grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : 'N/A'
              })()}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Risk Scorecard ────────────────────────────────────────── */

function RiskScorecard({ trades }: { trades: Trade[] }) {
  const stats = useMemo(() => {
    if (trades.length === 0) return null
    const risks = trades.map((t) => t.riskPercent)
    const avgRisk = risks.reduce((s, r) => s + r, 0) / risks.length
    const oversize = trades.filter((t) => t.riskPercent > 2).length
    const rrs = trades.map((t) => {
      const pip = t.pair.toUpperCase().includes('JPY') ? 0.01 : 0.0001
      const slPips = Math.abs(t.entry - t.stopLoss) / pip
      const tpPips = Math.abs(t.takeProfit - t.entry) / pip
      return slPips > 0 ? tpPips / slPips : 0
    })
    const avgRR = rrs.reduce((s, r) => s + r, 0) / rrs.length
    const rrBuckets = { '<1': 0, '1-2': 0, '2-3': 0, '3+': 0 }
    for (const rr of rrs) {
      if (rr < 1) rrBuckets['<1']++
      else if (rr < 2) rrBuckets['1-2']++
      else if (rr < 3) rrBuckets['2-3']++
      else rrBuckets['3+']++
    }
    const totalCommission = trades.reduce((s, t) => s + (t.enableCommission ? t.commissionPerLot * t.lotSize * 2 : 0), 0)
    return { avgRisk, oversize, avgRR, rrBuckets, totalCommission }
  }, [trades])

  if (!stats) return null

  const maxBucket = Math.max(...Object.values(stats.rrBuckets), 1)

  return (
    <div className="card analytics-section">
      <h3>Risk Scorecard</h3>
      <div className="streak-grid">
        <div className="streak-item">
          <span className="streak-label">Avg Risk Per Trade</span>
          <span className={`streak-value ${stats.avgRisk > 2 ? 'negative' : ''}`}>{stats.avgRisk.toFixed(2)}%</span>
        </div>
        <div className="streak-item">
          <span className="streak-label">Oversize Trades (&gt;2%)</span>
          <span className={`streak-value ${stats.oversize > 0 ? 'negative' : 'positive'}`}>{stats.oversize}</span>
        </div>
        <div className="streak-item">
          <span className="streak-label">Avg R:R Ratio</span>
          <span className="streak-value">{stats.avgRR.toFixed(2)}</span>
        </div>
        <div className="streak-item">
          <span className="streak-label">Total Commission Paid</span>
          <span className="streak-value">{fmt(stats.totalCommission)}</span>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <span className="streak-label" style={{ display: 'block', marginBottom: 10 }}>R:R Distribution</span>
        <div className="rr-histogram">
          {Object.entries(stats.rrBuckets).map(([label, count]) => (
            <div key={label} className="rr-bar-group">
              <div className="rr-bar-track">
                <div className="rr-bar-fill" style={{ height: `${(count / maxBucket) * 100}%` }} />
              </div>
              <span className="rr-bar-count">{count}</span>
              <span className="rr-bar-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Mistake Tracker ───────────────────────────────────────── */

function MistakeTracker({ trades }: { trades: Trade[] }) {
  const data = useMemo(() => {
    const map = new Map<string, { count: number; totalCost: number }>()
    for (const t of trades) {
      for (const m of (t.mistakes || [])) {
        const prev = map.get(m) || { count: 0, totalCost: 0 }
        map.set(m, {
          count: prev.count + 1,
          totalCost: prev.totalCost + (t.pnl < 0 ? Math.abs(t.pnl) : 0),
        })
      }
    }
    return Array.from(map, ([name, v]) => ({
      name,
      count: v.count,
      totalCost: v.totalCost,
      avgCost: v.count > 0 ? v.totalCost / v.count : 0,
    })).sort((a, b) => b.totalCost - a.totalCost)
  }, [trades])

  const tradesWithMistakes = trades.filter((t) => (t.mistakes || []).length > 0).length
  const maxCost = data.length ? Math.max(...data.map((d) => d.totalCost), 1) : 1

  return (
    <div className="card analytics-section">
      <h3>Mistake Tracker</h3>
      {data.length === 0 ? (
        <p className="muted" style={{ padding: '20px 0', textAlign: 'center' }}>
          No mistakes logged yet. Tag mistakes on your trades to track patterns.
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>
            {tradesWithMistakes} of {trades.length} trades had mistakes tagged
          </p>
          <div className="perf-table-scroll">
            <table className="perf-table">
              <thead>
                <tr>
                  <th>Mistake</th>
                  <th>Count</th>
                  <th>Total Cost</th>
                  <th style={{ width: '25%' }}>Impact</th>
                  <th>Avg Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.name}>
                    <td><strong>{d.name}</strong></td>
                    <td>{d.count}</td>
                    <td className="negative">{fmt(d.totalCost)}</td>
                    <td>
                      <div className="perf-bar-track">
                        <div className="perf-bar-fill neg" style={{ width: `${(d.totalCost / maxCost) * 100}%` }} />
                      </div>
                    </td>
                    <td className="negative">{fmt(d.avgCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Export Section ─────────────────────────────────────────── */

function ExportSection({ trades }: { trades: Trade[] }) {
  const [excelExporting, setExcelExporting] = useState(false)

  const exportCSV = () => {
    const headers = ['Date', 'Pair', 'Direction', 'Entry', 'Stop Loss', 'Take Profit', 'Lot Size', 'PnL', 'Return %', 'Commission', 'Capital', 'Risk %', 'Status', 'Tags', 'Mistakes', 'Notes']
    const rows = trades.map((t) => [
      new Date(t.openedAt).toLocaleDateString(),
      t.pair,
      t.direction,
      t.entry,
      t.stopLoss,
      t.takeProfit,
      t.lotSize,
      t.pnl,
      t.returnPercent,
      t.enableCommission ? t.commissionPerLot * t.lotSize * 2 : 0,
      t.capital,
      t.riskPercent,
      t.status,
      t.tags.join('; '),
      (t.mistakes || []).join('; '),
      t.notesHtml.replace(/"/g, '""'),
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = () => {
    const wins = trades.filter((t) => t.pnl > 0).length
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
    const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(1) : '0'
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Trade Journal Export</title>
<style>
  body{font-family:Arial,sans-serif;padding:24px;color:#1a1a1a}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
  th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}
  th{background:#f0f0f0;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
  .pos{color:#16a34a}.neg{color:#dc2626}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 8px}
  .summary{display:flex;gap:24px;margin:12px 0}
  .summary div{font-size:13px}.summary strong{font-size:18px;display:block}
</style></head><body>
<h1>Forex Trade Journal</h1>
<p style="color:#666">Exported ${new Date().toLocaleDateString()}</p>
<div class="summary">
  <div><strong>${trades.length}</strong>Total Trades</div>
  <div><strong>${winRate}%</strong>Win Rate</div>
  <div class="${totalPnl >= 0 ? 'pos' : 'neg'}"><strong>$${totalPnl.toFixed(2)}</strong>Total PnL</div>
</div>
<h2>Trade History</h2>
<table><thead><tr><th>Date</th><th>Pair</th><th>Dir</th><th>Entry</th><th>SL</th><th>TP</th><th>Lots</th><th>PnL</th><th>Tags</th><th>Mistakes</th></tr></thead><tbody>
${trades.sort((a, b) => b.openedAt.localeCompare(a.openedAt)).map((t) =>
  `<tr><td>${new Date(t.openedAt).toLocaleDateString()}</td><td>${t.pair}</td><td>${t.direction}</td><td>${t.entry}</td><td>${t.stopLoss}</td><td>${t.takeProfit}</td><td>${t.lotSize}</td><td class="${t.pnl >= 0 ? 'pos' : 'neg'}">$${t.pnl.toFixed(2)}</td><td>${t.tags.join(', ')}</td><td>${(t.mistakes || []).join(', ')}</td></tr>`
).join('')}
</tbody></table></body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 500)
  }

  return (
    <div className="card analytics-section">
      <h3>Export</h3>
      <p className="muted" style={{ marginBottom: 14 }}>Export your trade data for record-keeping, tax, or mentor review.</p>
      <div className="export-btns">
        <button className="btn-primary" onClick={exportCSV} disabled={trades.length === 0}>
          Export CSV
        </button>
        <button className="btn-secondary" onClick={exportPDF} disabled={trades.length === 0}>
          Export PDF (Print)
        </button>
        <button
          className="btn-secondary"
          disabled={trades.length === 0 || excelExporting}
          onClick={async () => {
            setExcelExporting(true)
            try {
              const api = getApi()
              const [allTrades, journals] = await Promise.all([
                api.listTrades(),
                api.listJournalEntries(),
              ])
              exportAllToExcel(allTrades, journals)
            } finally {
              setExcelExporting(false)
            }
          }}
        >
          {excelExporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>
    </div>
  )
}

/* ── Main Analytics Page ───────────────────────────────────── */

export function AnalyticsPage() {
  const { refreshKey } = useAccount()
  const trades = useQuery({ queryKey: ['trades', refreshKey], queryFn: () => getApi().listTrades() })
  const allTrades = trades.data ?? []

  const pairData = useMemo(() => groupBy(allTrades, (t) => t.pair), [allTrades])
  const tagData = useMemo(() => {
    const entries: GroupStats[] = []
    const map = new Map<string, Trade[]>()
    for (const t of allTrades) {
      for (const tag of t.tags) {
        if (!map.has(tag)) map.set(tag, [])
        map.get(tag)!.push(t)
      }
    }
    for (const [key, list] of map) {
      const wins = list.filter((t) => t.pnl > 0).length
      const totalPnl = list.reduce((s, t) => s + t.pnl, 0)
      const pnls = list.map((t) => t.pnl)
      entries.push({
        key,
        trades: list.length,
        wins,
        losses: list.length - wins,
        winRate: list.length ? (wins / list.length) * 100 : 0,
        totalPnl,
        avgPnl: list.length ? totalPnl / list.length : 0,
        bestTrade: Math.max(...pnls),
        worstTrade: Math.min(...pnls),
      })
    }
    return entries.sort((a, b) => b.totalPnl - a.totalPnl)
  }, [allTrades])

  const sessionData = useMemo(
    () => groupBy(allTrades, (t) => getSession(new Date(t.openedAt).getHours())),
    [allTrades],
  )
  const dayData = useMemo(
    () => groupBy(allTrades, (t) => getDayName(new Date(t.openedAt).getDay())),
    [allTrades],
  )

  const maxPairPnl = pairData.length ? Math.max(...pairData.map((d) => Math.abs(d.totalPnl)), 1) : 1
  const maxTagPnl = tagData.length ? Math.max(...tagData.map((d) => Math.abs(d.totalPnl)), 1) : 1
  const maxSessionPnl = sessionData.length ? Math.max(...sessionData.map((d) => Math.abs(d.totalPnl)), 1) : 1
  const maxDayPnl = dayData.length ? Math.max(...dayData.map((d) => Math.abs(d.totalPnl)), 1) : 1

  if (trades.isLoading) return <p className="muted">Loading analytics...</p>

  return (
    <>
      <PerfTable title="Pair Performance" data={pairData} maxPnl={maxPairPnl} />
      <PerfTable title="Setup / Tag Performance" data={tagData} maxPnl={maxTagPnl} />
      <PerfTable title="Session Analysis" data={sessionData} maxPnl={maxSessionPnl} />
      <PerfTable title="Day of Week Performance" data={dayData} maxPnl={maxDayPnl} />
      <StreakTracker trades={allTrades} />
      <RiskScorecard trades={allTrades} />
      <MistakeTracker trades={allTrades} />
      <ExportSection trades={allTrades} />
    </>
  )
}
