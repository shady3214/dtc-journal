import { supabase } from './supabase'
import type { Trade, JournalEntry, AppSettings } from '../types/domain'
import { DEFAULT_SETTINGS } from './api'

// ── Shared helpers ───────────────────────────────────────────

/** Parse chart_image_data which may be a JSON array or a legacy single data URL. */
function parseChartImages(raw: string | null | undefined): string[] {
  if (!raw) return []
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw) as string[] } catch { /* fall through */ }
  }
  return [raw]
}

// ── Helper: Trade object ↔ DB row mapping ───────────────────

function tradeToRow(trade: Trade, userId: string, accountId: string) {
  return {
    id: trade.id,
    user_id: userId,
    account_id: accountId,
    pair: trade.pair,
    direction: trade.direction,
    entry: trade.entry,
    stop_loss: trade.stopLoss,
    take_profit: trade.takeProfit,
    lot_size: trade.lotSize,
    capital: trade.capital,
    enable_commission: trade.enableCommission,
    commission_per_lot: trade.commissionPerLot,
    risk_percent: trade.riskPercent,
    pnl: trade.pnl,
    return_percent: trade.returnPercent,
    status: trade.status,
    tags: trade.tags,
    mistakes: trade.mistakes,
    setup: trade.setup || null,
    chart_image_data: trade.chartScreenshots?.length
      ? JSON.stringify(trade.chartScreenshots)
      : (trade.chartImageData || null),
    notes_html: trade.notesHtml,
    opened_at: trade.openedAt,
    closed_at: trade.closedAt || null,
    ai_analysis: trade.aiAnalysis || null,
  }
}

function rowToTrade(row: any): Trade {
  return {
    id: row.id,
    pair: row.pair,
    direction: row.direction,
    entry: row.entry,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    lotSize: row.lot_size,
    capital: row.capital,
    enableCommission: row.enable_commission,
    commissionPerLot: row.commission_per_lot,
    riskPercent: row.risk_percent,
    pnl: row.pnl,
    returnPercent: row.return_percent,
    status: row.status,
    tags: row.tags || [],
    mistakes: row.mistakes || [],
    setup: row.setup || undefined,
    chartImageData: parseChartImages(row.chart_image_data)[0] || undefined,
    chartScreenshots: parseChartImages(row.chart_image_data),
    notesHtml: row.notes_html,
    openedAt: row.opened_at,
    closedAt: row.closed_at || undefined,
    aiAnalysis: row.ai_analysis || undefined,
  }
}

// ── Journal mapping ─────────────────────────────────────────

function journalToRow(entry: JournalEntry, userId: string, accountId: string) {
  return {
    user_id: userId,
    account_id: accountId,
    date: entry.date,
    pre_bias: entry.preBias,
    pre_session: entry.preSession,
    pre_levels: entry.preLevels,
    pre_plan: entry.prePlan,
    post_went_well: entry.postWentWell,
    post_went_wrong: entry.postWentWrong,
    post_lessons: entry.postLessons,
    post_mood: entry.postMood,
    post_grade: entry.postGrade,
  }
}

function rowToJournal(row: any): JournalEntry {
  return {
    date: row.date,
    preBias: row.pre_bias,
    preSession: row.pre_session,
    preLevels: row.pre_levels,
    prePlan: row.pre_plan,
    postWentWell: row.post_went_well,
    postWentWrong: row.post_went_wrong,
    postLessons: row.post_lessons,
    postMood: row.post_mood,
    postGrade: row.post_grade,
  }
}

// ── Trades ──────────────────────────────────────────────────

export async function dbListTrades(userId: string, accountId: string): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .order('opened_at', { ascending: false })

  if (error) throw new Error(`Failed to load trades: ${error.message}`)
  return (data || []).map(rowToTrade)
}

export async function dbSaveTrade(trade: Trade, userId: string, accountId: string): Promise<Trade> {
  const row = tradeToRow(trade, userId, accountId)
  const { error } = await supabase
    .from('trades')
    .upsert(row, { onConflict: 'id' })

  if (error) throw new Error(`Failed to save trade: ${error.message}`)
  return trade
}

export async function dbDeleteTrade(id: string, userId: string, accountId: string): Promise<void> {
  const { error } = await supabase
    .from('trades')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .eq('account_id', accountId)

  if (error) throw new Error(`Failed to delete trade: ${error.message}`)
}

// ── Journal Entries ─────────────────────────────────────────

export async function dbGetJournalEntry(userId: string, accountId: string, date: string): Promise<JournalEntry | null> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .eq('date', date)
    .maybeSingle()

  if (error) throw new Error(`Failed to load journal: ${error.message}`)
  return data ? rowToJournal(data) : null
}

export async function dbSaveJournalEntry(entry: JournalEntry, userId: string, accountId: string): Promise<JournalEntry> {
  const row = journalToRow(entry, userId, accountId)
  const { error } = await supabase
    .from('journal_entries')
    .upsert(row, { onConflict: 'user_id,account_id,date' })

  if (error) throw new Error(`Failed to save journal entry: ${error.message}`)
  return entry
}

export async function dbListJournalEntries(userId: string, accountId: string): Promise<JournalEntry[]> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .order('date', { ascending: false })

  if (error) throw new Error(`Failed to load journal entries: ${error.message}`)
  return (data || []).map(rowToJournal)
}

// ── Settings ────────────────────────────────────────────────

export async function dbGetSettings(userId: string): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('settings')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load settings: ${error.message}`)
  if (!data) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...data.settings }
}

export async function dbSaveSettings(settings: AppSettings, userId: string): Promise<AppSettings> {
  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: userId,
      settings,
    }, { onConflict: 'user_id' })

  if (error) throw new Error(`Failed to save settings: ${error.message}`)
  return settings
}

// ── Data Management ─────────────────────────────────────────

export async function dbClearTrades(userId: string, accountId: string): Promise<void> {
  const { error } = await supabase
    .from('trades')
    .delete()
    .eq('user_id', userId)
    .eq('account_id', accountId)
  if (error) throw new Error(`Failed to clear trades: ${error.message}`)
}

export async function dbClearJournals(userId: string, accountId: string): Promise<void> {
  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('user_id', userId)
    .eq('account_id', accountId)
  if (error) throw new Error(`Failed to clear journals: ${error.message}`)
}

export async function dbClearAllData(userId: string): Promise<void> {
  const { error: tradeError } = await supabase
    .from('trades')
    .delete()
    .eq('user_id', userId)
  if (tradeError) throw new Error(`Failed to clear trades: ${tradeError.message}`)

  const { error: journalError } = await supabase
    .from('journal_entries')
    .delete()
    .eq('user_id', userId)
  if (journalError) throw new Error(`Failed to clear journals: ${journalError.message}`)

  const { error } = await supabase
    .from('user_settings')
    .delete()
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to clear settings: ${error.message}`)
}

export async function dbExportAllData(userId: string, accountId: string): Promise<string> {
  const trades = await dbListTrades(userId, accountId)
  const journals = await dbListJournalEntries(userId, accountId)
  const settings = await dbGetSettings(userId)
  return JSON.stringify({ trades, journals, settings, exportedAt: new Date().toISOString() }, null, 2)
}

export async function dbImportAllData(
  json: string,
  userId: string,
  accountId: string
): Promise<{ trades: number; journals: number }> {
  const data = JSON.parse(json)
  let tradeCount = 0
  let journalCount = 0

  if (data.trades && Array.isArray(data.trades)) {
    for (const trade of data.trades) {
      await dbSaveTrade(trade, userId, accountId)
    }
    tradeCount = data.trades.length
  }

  if (data.journals) {
    // journals can be array or object keyed by date
    const entries: JournalEntry[] = Array.isArray(data.journals)
      ? data.journals
      : Object.values(data.journals)
    for (const entry of entries) {
      await dbSaveJournalEntry(entry, userId, accountId)
    }
    journalCount = entries.length
  }

  if (data.settings && typeof data.settings === 'object') {
    const currentSettings = await dbGetSettings(userId)
    await dbSaveSettings({
      ...DEFAULT_SETTINGS,
      ...currentSettings,
      ...data.settings,
      accounts: currentSettings.accounts,
      activeAccountId: currentSettings.activeAccountId,
    }, userId)
  }

  return { trades: tradeCount, journals: journalCount }
}
