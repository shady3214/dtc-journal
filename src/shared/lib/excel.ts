import * as XLSX from 'xlsx'
import type { Trade, JournalEntry } from '../types/domain'

/**
 * Export trades to an Excel (.xlsx) file and trigger download.
 */
export function exportTradesToExcel(trades: Trade[], filename?: string) {
  const rows = trades.map((t) => ({
    'ID': t.id,
    'Symbol': t.pair,
    'Direction': t.direction,
    'Status': t.status,
    'Entry Price': t.entry,
    'Stop Loss': t.stopLoss,
    'Take Profit': t.takeProfit,
    'Lot Size': t.lotSize,
    'Capital': t.capital,
    'Risk %': t.riskPercent,
    'P&L': t.pnl,
    'Return %': t.returnPercent,
    'Commission/Lot': t.commissionPerLot,
    'Setup': t.setup || '',
    'Tags': (t.tags || []).join(', '),
    'Mistakes': (t.mistakes || []).join(', '),
    'Notes': t.notesHtml.replace(/<[^>]*>/g, ''),
    'Opened': t.openedAt,
    'Closed': t.closedAt || '',
    'AI Summary': t.aiAnalysis?.summary || '',
    'AI Setup': t.aiAnalysis?.setupClassification || '',
    'AI Confidence': t.aiAnalysis?.confidence ?? '',
  }))

  const ws = XLSX.utils.json_to_sheet(rows)

  // Auto-size columns
  const colWidths = Object.keys(rows[0] || {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.map((r) => String((r as any)[key] || '').length)
    )
    return { wch: Math.min(maxLen + 2, 50) }
  })
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Trades')

  XLSX.writeFile(wb, filename || `dtc-journal-trades-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/**
 * Export journal entries to an Excel (.xlsx) file and trigger download.
 */
export function exportJournalToExcel(entries: JournalEntry[], filename?: string) {
  const rows = entries.map((e) => ({
    'Date': e.date,
    'Pre-Session Bias': e.preBias,
    'Session': e.preSession,
    'Key Levels': e.preLevels,
    'Plan': e.prePlan,
    'What Went Well': e.postWentWell,
    'What Went Wrong': e.postWentWrong,
    'Lessons': e.postLessons,
    'Mood (1-5)': e.postMood,
    'Grade': e.postGrade,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)

  const colWidths = Object.keys(rows[0] || {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...rows.map((r) => String((r as any)[key] || '').length)
    )
    return { wch: Math.min(maxLen + 2, 60) }
  })
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Journal')

  XLSX.writeFile(wb, filename || `dtc-journal-entries-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/**
 * Export all data (trades + journal) in a single Excel workbook with multiple sheets.
 */
export function exportAllToExcel(trades: Trade[], entries: JournalEntry[], filename?: string) {
  const wb = XLSX.utils.book_new()

  // Trades sheet
  const tradeRows = trades.map((t) => ({
    'ID': t.id,
    'Symbol': t.pair,
    'Direction': t.direction,
    'Status': t.status,
    'Entry Price': t.entry,
    'Stop Loss': t.stopLoss,
    'Take Profit': t.takeProfit,
    'Lot Size': t.lotSize,
    'Capital': t.capital,
    'Risk %': t.riskPercent,
    'P&L': t.pnl,
    'Return %': t.returnPercent,
    'Commission/Lot': t.commissionPerLot,
    'Setup': t.setup || '',
    'Tags': (t.tags || []).join(', '),
    'Mistakes': (t.mistakes || []).join(', '),
    'Notes': t.notesHtml.replace(/<[^>]*>/g, ''),
    'Opened': t.openedAt,
    'Closed': t.closedAt || '',
    'AI Summary': t.aiAnalysis?.summary || '',
    'AI Setup': t.aiAnalysis?.setupClassification || '',
    'AI Confidence': t.aiAnalysis?.confidence ?? '',
  }))
  const wsTrades = XLSX.utils.json_to_sheet(tradeRows)
  if (tradeRows.length > 0) {
    wsTrades['!cols'] = Object.keys(tradeRows[0]).map((key) => {
      const maxLen = Math.max(key.length, ...tradeRows.map((r) => String((r as any)[key] || '').length))
      return { wch: Math.min(maxLen + 2, 50) }
    })
  }
  XLSX.utils.book_append_sheet(wb, wsTrades, 'Trades')

  // Journal sheet
  const journalRows = entries.map((e) => ({
    'Date': e.date,
    'Pre-Session Bias': e.preBias,
    'Session': e.preSession,
    'Key Levels': e.preLevels,
    'Plan': e.prePlan,
    'What Went Well': e.postWentWell,
    'What Went Wrong': e.postWentWrong,
    'Lessons': e.postLessons,
    'Mood (1-5)': e.postMood,
    'Grade': e.postGrade,
  }))
  const wsJournal = XLSX.utils.json_to_sheet(journalRows)
  if (journalRows.length > 0) {
    wsJournal['!cols'] = Object.keys(journalRows[0]).map((key) => {
      const maxLen = Math.max(key.length, ...journalRows.map((r) => String((r as any)[key] || '').length))
      return { wch: Math.min(maxLen + 2, 60) }
    })
  }
  XLSX.utils.book_append_sheet(wb, wsJournal, 'Journal')

  // Summary sheet
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const summaryRows = [
    { 'Metric': 'Total Trades', 'Value': trades.length },
    { 'Metric': 'Wins', 'Value': wins.length },
    { 'Metric': 'Losses', 'Value': losses.length },
    { 'Metric': 'Win Rate', 'Value': trades.length ? `${((wins.length / trades.length) * 100).toFixed(1)}%` : '0%' },
    { 'Metric': 'Total P&L', 'Value': `$${totalPnl.toFixed(2)}` },
    { 'Metric': 'Avg Win', 'Value': wins.length ? `$${(wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2)}` : '$0' },
    { 'Metric': 'Avg Loss', 'Value': losses.length ? `$${(losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2)}` : '$0' },
    { 'Metric': 'Journal Entries', 'Value': entries.length },
    { 'Metric': 'Export Date', 'Value': new Date().toISOString() },
  ]
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows)
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 25 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  XLSX.writeFile(wb, filename || `dtc-journal-full-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
