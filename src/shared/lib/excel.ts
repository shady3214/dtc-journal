import * as XLSX from 'xlsx'
import type { Trade, JournalEntry } from '../types/domain'

/* ── Shared analytics helpers (mirrored from AnalyticsPage) ── */

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

function buildGroupRows(data: GroupStats[]) {
  return data.map((d) => ({
    'Name':       d.key,
    'Trades':     d.trades,
    'Wins':       d.wins,
    'Losses':     d.losses,
    'Win Rate %': +d.winRate.toFixed(1),
    'Total PnL':  +d.totalPnl.toFixed(2),
    'Avg PnL':    +d.avgPnl.toFixed(2),
    'Best Trade': +d.bestTrade.toFixed(2),
    'Worst Trade':+d.worstTrade.toFixed(2),
  }))
}

function autoWidth(rows: Record<string, any>[]): XLSX.ColInfo[] {
  if (!rows.length) return []
  return Object.keys(rows[0]).map((key) => {
    const maxLen = Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length))
    return { wch: Math.min(maxLen + 2, 50) }
  })
}

function appendSheet(wb: XLSX.WorkBook, rows: Record<string, any>[], name: string) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '(no data)': '' }])
  ws['!cols'] = autoWidth(rows)
  XLSX.utils.book_append_sheet(wb, ws, name)
}

/* ── Analytics computation ────────────────────────────────── */

function buildAnalytics(trades: Trade[]) {
  const pairData    = groupBy(trades, (t) => t.pair)
  const sessionData = groupBy(trades, (t) => getSession(new Date(t.openedAt).getHours()))
  const dayData     = groupBy(trades, (t) => getDayName(new Date(t.openedAt).getDay()))

  // Tag/setup performance
  const tagMap = new Map<string, Trade[]>()
  for (const t of trades) {
    for (const tag of t.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, [])
      tagMap.get(tag)!.push(t)
    }
  }
  const tagData: GroupStats[] = Array.from(tagMap, ([key, list]) => {
    const wins = list.filter((t) => t.pnl > 0).length
    const totalPnl = list.reduce((s, t) => s + t.pnl, 0)
    const pnls = list.map((t) => t.pnl)
    return {
      key, trades: list.length, wins, losses: list.length - wins,
      winRate: list.length ? (wins / list.length) * 100 : 0,
      totalPnl, avgPnl: list.length ? totalPnl / list.length : 0,
      bestTrade: Math.max(...pnls), worstTrade: Math.min(...pnls),
    }
  }).sort((a, b) => b.totalPnl - a.totalPnl)

  // Mistake tracker
  const mistakeMap = new Map<string, { count: number; totalCost: number }>()
  for (const t of trades) {
    for (const m of (t.mistakes || [])) {
      const prev = mistakeMap.get(m) || { count: 0, totalCost: 0 }
      mistakeMap.set(m, { count: prev.count + 1, totalCost: prev.totalCost + (t.pnl < 0 ? Math.abs(t.pnl) : 0) })
    }
  }
  const mistakeData = Array.from(mistakeMap, ([name, v]) => ({
    'Mistake':    name,
    'Count':      v.count,
    'Total Cost': +v.totalCost.toFixed(2),
    'Avg Cost':   +(v.count > 0 ? v.totalCost / v.count : 0).toFixed(2),
  })).sort((a, b) => b['Total Cost'] - a['Total Cost'])

  // Streak + drawdown
  const sorted = [...trades].sort((a, b) => a.openedAt.localeCompare(b.openedAt))
  let maxWinStreak = 0, maxLossStreak = 0, tempWin = 0, tempLoss = 0
  let maxDrawdown = 0, runningDD = 0
  let currentStreak = 0, currentType = ''
  for (const t of sorted) {
    if (t.pnl > 0) { tempWin++; tempLoss = 0; maxWinStreak = Math.max(maxWinStreak, tempWin); runningDD = 0 }
    else { tempLoss++; tempWin = 0; maxLossStreak = Math.max(maxLossStreak, tempLoss); runningDD += Math.abs(t.pnl); maxDrawdown = Math.max(maxDrawdown, runningDD) }
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const type = sorted[i].pnl > 0 ? 'Win' : 'Loss'
    if (i === sorted.length - 1) { currentType = type; currentStreak = 1 }
    else if (type === currentType) currentStreak++
    else break
  }

  // Risk scorecard
  const avgRisk = trades.length ? trades.reduce((s, t) => s + t.riskPercent, 0) / trades.length : 0
  const oversize = trades.filter((t) => t.riskPercent > 2).length
  const rrs = trades.map((t) => {
    const pip = t.pair.toUpperCase().includes('JPY') ? 0.01 : 0.0001
    const slPips = Math.abs(t.entry - t.stopLoss) / pip
    const tpPips = Math.abs(t.takeProfit - t.entry) / pip
    return slPips > 0 ? tpPips / slPips : 0
  })
  const avgRR = rrs.length ? rrs.reduce((s, r) => s + r, 0) / rrs.length : 0
  const totalCommission = trades.reduce((s, t) => s + (t.enableCommission ? t.commissionPerLot * t.lotSize * 2 : 0), 0)

  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null

  const summaryData = [
    { 'Metric': 'Total Trades',          'Value': trades.length },
    { 'Metric': 'Wins',                  'Value': wins.length },
    { 'Metric': 'Losses',                'Value': losses.length },
    { 'Metric': 'Win Rate',              'Value': trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0 },
    { 'Metric': 'Total P&L',             'Value': +totalPnl.toFixed(2) },
    { 'Metric': 'Gross Profit',          'Value': +grossWin.toFixed(2) },
    { 'Metric': 'Gross Loss',            'Value': +(-grossLoss).toFixed(2) },
    { 'Metric': 'Avg Win',               'Value': wins.length ? +(grossWin / wins.length).toFixed(2) : 0 },
    { 'Metric': 'Avg Loss',              'Value': losses.length ? +(losses.reduce((s,t)=>s+t.pnl,0)/losses.length).toFixed(2) : 0 },
    { 'Metric': 'Profit Factor',         'Value': profitFactor !== null ? +profitFactor.toFixed(2) : 'N/A' },
    { 'Metric': 'Avg Risk Per Trade %',  'Value': +avgRisk.toFixed(2) },
    { 'Metric': 'Oversize Trades (>2%)', 'Value': oversize },
    { 'Metric': 'Avg R:R Ratio',         'Value': +avgRR.toFixed(2) },
    { 'Metric': 'Total Commission Paid', 'Value': +totalCommission.toFixed(2) },
    { 'Metric': 'Max Win Streak',        'Value': maxWinStreak },
    { 'Metric': 'Max Loss Streak',       'Value': maxLossStreak },
    { 'Metric': 'Max Consecutive Loss $','Value': +maxDrawdown.toFixed(2) },
    { 'Metric': 'Current Streak',        'Value': sorted.length ? `${currentStreak} ${currentType}${currentStreak !== 1 ? 's' : ''}` : 'N/A' },
    { 'Metric': 'Export Date',           'Value': new Date().toISOString() },
  ]

  return { pairData, tagData, sessionData, dayData, mistakeData, summaryData }
}

/* ── Excel export ─────────────────────────────────────────── */

export function exportTradesToExcel(trades: Trade[], filename?: string) {
  const rows = trades.map((t) => ({
    'ID': t.id, 'Symbol': t.pair, 'Direction': t.direction, 'Status': t.status,
    'Entry Price': t.entry, 'Stop Loss': t.stopLoss, 'Take Profit': t.takeProfit,
    'Lot Size': t.lotSize, 'Capital': t.capital, 'Risk %': t.riskPercent,
    'P&L': t.pnl, 'Return %': t.returnPercent, 'Commission/Lot': t.commissionPerLot,
    'Setup': t.setup || '', 'Tags': (t.tags || []).join(', '),
    'Mistakes': (t.mistakes || []).join(', '),
    'Chart Link': t.chartLink || '',
    'Notes': t.notesHtml.replace(/<[^>]*>/g, ''),
    'Opened': t.openedAt, 'Closed': t.closedAt || '',
    'AI Summary': t.aiAnalysis?.summary || '',
    'AI Setup': t.aiAnalysis?.setupClassification || '',
    'AI Confidence': t.aiAnalysis?.confidence ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = autoWidth(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Trades')
  XLSX.writeFile(wb, filename || `dtc-journal-trades-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export function exportJournalToExcel(entries: JournalEntry[], filename?: string) {
  const rows = entries.map((e) => ({
    'Date': e.date, 'Pre-Session Bias': e.preBias, 'Session': e.preSession,
    'Key Levels': e.preLevels, 'Plan': e.prePlan, 'What Went Well': e.postWentWell,
    'What Went Wrong': e.postWentWrong, 'Lessons': e.postLessons,
    'Mood (1-5)': e.postMood, 'Grade': e.postGrade,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = autoWidth(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Journal')
  XLSX.writeFile(wb, filename || `dtc-journal-entries-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export function exportAllToExcel(trades: Trade[], entries: JournalEntry[], filename?: string) {
  const wb = XLSX.utils.book_new()
  const an = buildAnalytics(trades)

  // 1. Summary
  appendSheet(wb, an.summaryData, 'Summary')

  // 2. Trades
  const tradeRows = trades.map((t) => ({
    'Date': new Date(t.openedAt).toLocaleDateString(),
    'Symbol': t.pair, 'Direction': t.direction, 'Status': t.status,
    'Entry Price': t.entry, 'Stop Loss': t.stopLoss, 'Take Profit': t.takeProfit,
    'Lot Size': t.lotSize, 'Capital': t.capital, 'Risk %': t.riskPercent,
    'P&L': t.pnl, 'Return %': t.returnPercent, 'Commission/Lot': t.commissionPerLot,
    'Setup': t.setup || '', 'Tags': (t.tags || []).join(', '),
    'Mistakes': (t.mistakes || []).join(', '),
    'Chart Link': t.chartLink || '',
    'Notes': t.notesHtml.replace(/<[^>]*>/g, ''),
    'Opened': t.openedAt, 'Closed': t.closedAt || '',
    'AI Summary': t.aiAnalysis?.summary || '',
  }))
  appendSheet(wb, tradeRows, 'Trades')

  // 3. Pair Performance
  appendSheet(wb, buildGroupRows(an.pairData), 'Pair Performance')

  // 4. Setup / Tag Performance
  appendSheet(wb, buildGroupRows(an.tagData), 'Setup Performance')

  // 5. Session Analysis
  appendSheet(wb, buildGroupRows(an.sessionData), 'Session Analysis')

  // 6. Day of Week
  appendSheet(wb, buildGroupRows(an.dayData), 'Day of Week')

  // 7. Mistake Tracker
  appendSheet(wb, an.mistakeData, 'Mistake Tracker')

  // 8. Journal
  const journalRows = entries.map((e) => ({
    'Date': e.date, 'Pre-Session Bias': e.preBias, 'Session': e.preSession,
    'Key Levels': e.preLevels, 'Plan': e.prePlan, 'What Went Well': e.postWentWell,
    'What Went Wrong': e.postWentWrong, 'Lessons': e.postLessons,
    'Mood (1-5)': e.postMood, 'Grade': e.postGrade,
    'AI Mentor': e.aiFeedback?.mentor || '',
    'AI Focus Question': e.aiFeedback?.focusQuestion || '',
  }))
  appendSheet(wb, journalRows, 'Journal')

  XLSX.writeFile(wb, filename || `dtc-journal-full-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
