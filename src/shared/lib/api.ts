import type { AiAnalysis, AnalyticsSummary, AppSettings, CalendarDayStat, JournalEntry, JournalAiFeedback, ThemeName, Trade, TradingAccount } from '../types/domain'
import {
  dbListTrades, dbSaveTrade, dbDeleteTrade,
  dbGetJournalEntry, dbSaveJournalEntry, dbListJournalEntries,
  dbGetSettings, dbSaveSettings,
  dbExportAllData, dbImportAllData,
  dbClearTrades, dbClearJournals, dbClearAllData,
} from './database'

// ── Detect Tauri runtime ────────────────────────────────────

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
    return tauriInvoke<T>(cmd, args)
  }
  throw new Error('Tauri runtime not available')
}

// ── File-based persistence (Tauri only, AppData folder) ─────
// Data is stored in %APPDATA%\com.dtc.journal\ as JSON files.
// This survives app reinstalls because Windows does not remove AppData on uninstall.
// localStorage is kept in sync as a fast synchronous read cache.
//
// The plugin specifier is kept in a variable so Vite's static import analysis
// does NOT try to resolve/bundle it in browser/dev mode (it's Tauri-only).

const FILE_SETTINGS = 'journal_settings.json'
const FILE_JOURNAL_PREFIX = 'journal_entries'
const _fsPlugin = '@tauri-apps/plugin-fs' // opaque to Vite static analysis

async function fsWriteText(filename: string, text: string): Promise<void> {
  if (!isTauri) return
  try {
    const { BaseDirectory, mkdir, writeTextFile } = await import(/* @vite-ignore */ _fsPlugin)
    try { await mkdir('', { baseDir: BaseDirectory.AppData, recursive: true }) } catch { /* already exists */ }
    await writeTextFile(filename, text, { baseDir: BaseDirectory.AppData })
  } catch (e) {
    console.warn('[fs] write failed:', e)
  }
}

async function fsReadText(filename: string): Promise<string | null> {
  if (!isTauri) return null
  try {
    const { BaseDirectory, readTextFile } = await import(/* @vite-ignore */ _fsPlugin)
    return await readTextFile(filename, { baseDir: BaseDirectory.AppData })
  } catch {
    return null
  }
}


/** Write settings to both localStorage and AppData file (Tauri only). */
export async function persistSettingsAsync(settings: AppSettings): Promise<void> {
  const json = JSON.stringify(settings)
  localStorage.setItem(SETTINGS_KEY, json)
  if (isTauri) {
    await fsWriteText(FILE_SETTINGS, json)
  }
}

/** Load settings: in Tauri mode tries AppData file first, then falls back to localStorage. */
export async function loadSettingsAsync(): Promise<AppSettings> {
  if (isTauri) {
    const raw = await fsReadText(FILE_SETTINGS)
    if (raw) {
      try {
        const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
        // Also sync back to localStorage so synchronous loadSettings() stays current
        localStorage.setItem(SETTINGS_KEY, raw)
        return applySettingsMigrations(parsed)
      } catch { /* fall through to localStorage */ }
    }
  }
  return loadSettings()
}

function applySettingsMigrations(parsed: AppSettings): AppSettings {
  const theme = parsed.theme as string
  if (theme !== 'amoled' && theme !== 'white') parsed.theme = 'amoled'
  if (!parsed.accounts || !Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
    parsed.accounts = [{ ...DEFAULT_ACCOUNT, capital: parsed.startingCapital || parsed.defaultCapital || 1000 }]
    parsed.activeAccountId = DEFAULT_ACCOUNT_ID
  }
  if (!parsed.activeAccountId) {
    parsed.activeAccountId = parsed.accounts[0]?.id || DEFAULT_ACCOUNT_ID
  }
  return parsed
}

/** One-time migration: on first Tauri launch, copy any existing localStorage data to AppData files. */
export async function migrateLocalStorageToFiles(): Promise<void> {
  if (!isTauri) return
  // Only migrate if the settings file doesn't exist yet
  const existing = await fsReadText(FILE_SETTINGS)
  if (existing) return // already migrated

  const settingsRaw = localStorage.getItem(SETTINGS_KEY)
  if (settingsRaw) {
    await fsWriteText(FILE_SETTINGS, settingsRaw)
  }

  // Migrate journal entries for all accounts
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('journal_entries')) {
      const acctSuffix = k === JOURNAL_KEY ? '' : k.slice(JOURNAL_KEY.length)
      const filename = `${FILE_JOURNAL_PREFIX}${acctSuffix}.json`
      const raw = localStorage.getItem(k)
      if (raw) await fsWriteText(filename, raw)
    }
  }
}

// ── Shared helpers ───────────────────────────────────────────

/** Parse chart_image_data which may be a JSON array or a legacy single data URL. */
export function parseChartImages(raw: string | null | undefined): string[] {
  if (!raw) return []
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw) as string[] } catch { /* fall through */ }
  }
  return [raw]
}

/** Get the first valid image data URL from a trade (handles array and legacy formats). */
function getPrimaryChartImage(chartImageData: string | undefined): { dataUrl: string; mimeType: string; b64: string } | null {
  if (!chartImageData) return null
  const images = parseChartImages(chartImageData)
  const first = images[0]
  if (!first) return null
  const match = first.match(/^data:(image\/\w+);base64,(.+)/)
  return {
    dataUrl: first,
    mimeType: match ? match[1] : 'image/png',
    b64: match ? match[2] : first,
  }
}

// ── localStorage fallback for browser dev ───────────────────

const STORAGE_KEY = 'journal_trades'
const JOURNAL_KEY = 'journal_entries'
const SETTINGS_KEY = 'journal_settings'

const DEFAULT_ACCOUNT_ID = 'default'

const DEFAULT_ACCOUNT: TradingAccount = {
  id: DEFAULT_ACCOUNT_ID,
  name: 'Main Account',
  capital: 1000,
  createdAt: new Date().toISOString(),
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: '',
  startingCapital: 0,
  accounts: [DEFAULT_ACCOUNT],
  activeAccountId: DEFAULT_ACCOUNT_ID,
  defaultCapital: 1000,
  defaultRiskPercent: 1,
  defaultCommissionPerLot: 0,
  defaultSession: '',
  defaultDirectPnl: false,
  aiProvider: 'groq',
  groqApiKey: '',
  groqModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llava-llama3',
  ollamaTimeoutSecs: 180,
  // Notifications
  notificationsEnabled: false,
  notifyNewsEvents: true,
  notifyCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'CAD'],
  notifyMinutesBefore: 15,
  notifyNyOpen: true,
  notifyLondonOpen: false,
  notifyNyOpenMinutesBefore: 15,
  theme: 'amoled' as ThemeName,
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS, accounts: [{ ...DEFAULT_ACCOUNT }] }
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    // Migrate legacy theme values
    const theme = parsed.theme as string
    if (theme !== 'amoled' && theme !== 'white') {
      parsed.theme = 'amoled'
    }
    // Migrate: ensure accounts array exists
    if (!parsed.accounts || !Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
      parsed.accounts = [{ ...DEFAULT_ACCOUNT, capital: parsed.startingCapital || parsed.defaultCapital || 1000 }]
      parsed.activeAccountId = DEFAULT_ACCOUNT_ID
    }
    if (!parsed.activeAccountId) {
      parsed.activeAccountId = parsed.accounts[0]?.id || DEFAULT_ACCOUNT_ID
    }
    return parsed
  } catch {
    return { ...DEFAULT_SETTINGS, accounts: [{ ...DEFAULT_ACCOUNT }] }
  }
}

export function persistSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  // Also write to AppData file for persistence across reinstalls (fire-and-forget)
  if (isTauri) {
    fsWriteText(FILE_SETTINGS, JSON.stringify(settings)).catch(() => {})
  }
}

/** Get the active account ID from settings */
export function getActiveAccountId(): string {
  const settings = loadSettings()
  return settings.activeAccountId || DEFAULT_ACCOUNT_ID
}

/** Get account-scoped localStorage key */
function acctKey(base: string): string {
  const acctId = getActiveAccountId()
  // Default account uses unscoped keys for backward compatibility with existing data
  if (acctId === DEFAULT_ACCOUNT_ID) return base
  return `${base}_${acctId}`
}

function acctKeyFor(base: string, accountId: string): string {
  if (accountId === DEFAULT_ACCOUNT_ID) return base
  return `${base}_${accountId}`
}

function loadTrades(accountId = getActiveAccountId()): Trade[] {
  try {
    const raw = JSON.parse(localStorage.getItem(acctKeyFor(STORAGE_KEY, accountId)) || '[]')
    // Migration: ensure new fields exist on old trades
    return raw.map((t: any) => ({
      ...t,
      mistakes: t.mistakes || [],
      tags: t.tags || [],
    }))
  } catch {
    return []
  }
}

function persistTrades(trades: Trade[]) {
  localStorage.setItem(acctKey(STORAGE_KEY), JSON.stringify(trades))
}

function loadJournalEntries(accountId = getActiveAccountId()): Record<string, JournalEntry> {
  try {
    return JSON.parse(localStorage.getItem(acctKeyFor(JOURNAL_KEY, accountId)) || '{}')
  } catch {
    return {}
  }
}

function persistJournalEntries(entries: Record<string, JournalEntry>) {
  localStorage.setItem(acctKey(JOURNAL_KEY), JSON.stringify(entries))
  // Also write to AppData file for persistence across reinstalls (fire-and-forget)
  if (isTauri) {
    const acctId = getActiveAccountId()
    const filename = acctId === DEFAULT_ACCOUNT_ID ? `${FILE_JOURNAL_PREFIX}.json` : `${FILE_JOURNAL_PREFIX}_${acctId}.json`
    fsWriteText(filename, JSON.stringify(entries)).catch(() => {})
  }
}

// ── AI Provider Helpers ─────────────────────────────────────

const GEMINI_FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
]

async function callGemini(settings: AppSettings, prompt: string, b64: string, mimeType: string): Promise<string> {
  const apiKey = settings.geminiApiKey
  if (!apiKey) throw new Error('Gemini API key not set. Go to Settings > AI Configuration and enter your API key from https://aistudio.google.com/apikey')

  const preferredModel = settings.geminiModel || DEFAULT_SETTINGS.geminiModel
  // Build ordered list: preferred model first, then fallbacks (deduped)
  const modelsToTry = [preferredModel, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== preferredModel)]

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: b64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  }

  let lastError = ''

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new Error('Could not connect to Gemini API. Check your internet connection.')
    }

    if (resp.ok) {
      const data = await resp.json()
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      if (!content) {
        const blockReason = data?.candidates?.[0]?.finishReason
        if (blockReason === 'SAFETY') throw new Error('Gemini blocked the response due to safety filters. Try a different chart image.')
        throw new Error('Gemini returned an empty response.')
      }
      return content
    }

    // Parse error
    let errBody = ''
    let errMessage = ''
    try {
      errBody = await resp.text()
      const errJson = JSON.parse(errBody)
      errMessage = errJson?.error?.message || ''
    } catch { /* use raw */ }

    if (resp.status === 400 && (errBody.includes('API_KEY_INVALID') || errMessage.includes('API key not valid'))) {
      throw new Error('Invalid Gemini API key. Get a free key at https://aistudio.google.com/apikey')
    }
    if (resp.status === 403) {
      throw new Error(`Gemini API forbidden (403): ${errMessage || 'The API key may not have access to this model.'}`)
    }

    // 429 = quota/rate limit, 404 = model not available — try next model
    if (resp.status === 429 || resp.status === 404) {
      lastError = `${model}: ${resp.status === 429 ? 'quota exceeded' : 'not found'}`
      continue
    }

    // Other errors — don't retry
    throw new Error(`Gemini API error ${resp.status}: ${errMessage || errBody.slice(0, 300)}`)
  }

  // All models exhausted
  throw new Error(
    `All Gemini models quota exceeded (${lastError}). ` +
    `Either wait a minute and retry, or try regenerating your API key at https://aistudio.google.com/apikey ` +
    `(make sure to create the key from AI Studio, not Google Cloud Console).`
  )
}

async function callGroq(settings: AppSettings, prompt: string, b64: string, mimeType: string): Promise<string> {
  const apiKey = settings.groqApiKey
  if (!apiKey) throw new Error('Groq API key not set. Go to Settings > AI Configuration and enter your API key from https://console.groq.com/keys')

  const model = settings.groqModel || DEFAULT_SETTINGS.groqModel
  const url = 'https://api.groq.com/openai/v1/chat/completions'
  const imageUrl = `data:${mimeType};base64,${b64}`

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      }),
    })
  } catch {
    throw new Error('Could not connect to Groq API. Check your internet connection.')
  }

  if (!resp.ok) {
    let errMessage = ''
    try {
      const errJson = await resp.json()
      errMessage = errJson?.error?.message || ''
    } catch {
      errMessage = await resp.text().catch(() => '')
    }

    if (resp.status === 401) {
      throw new Error('Invalid Groq API key. Get a free key at https://console.groq.com/keys')
    }
    if (resp.status === 429) {
      throw new Error(`Groq rate limit reached. Wait a moment and try again. ${errMessage}`)
    }
    throw new Error(`Groq API error ${resp.status}: ${errMessage.slice(0, 300)}`)
  }

  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content || ''
  if (!content) throw new Error('Groq returned an empty response.')
  return content
}

async function callOllama(settings: AppSettings, prompt: string, b64: string): Promise<string> {
  const ollamaUrl = settings.ollamaUrl || DEFAULT_SETTINGS.ollamaUrl
  const ollamaModel = settings.ollamaModel || DEFAULT_SETTINGS.ollamaModel
  const timeoutMs = (settings.ollamaTimeoutSecs || DEFAULT_SETTINGS.ollamaTimeoutSecs) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let resp: Response
  try {
    resp = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        messages: [{ role: 'user', content: prompt, images: [b64] }],
        options: { temperature: 0.3, num_predict: 1024 },
      }),
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${settings.ollamaTimeoutSecs}s. Increase timeout in Settings or use a smaller model.`)
    }
    throw new Error(
      `Could not connect to Ollama at ${ollamaUrl}. Make sure Ollama is running (ollama serve) and the ${ollamaModel} model is pulled (ollama pull ${ollamaModel}).`
    )
  }
  clearTimeout(timer)

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Ollama returned ${resp.status}: ${text}`)
  }

  const data = await resp.json()
  return data?.message?.content || ''
}

function parseAiResponse(raw: string): {
  summary: string
  mistakes: string[]
  setupClassification: string
  riskFeedback: string
  confidence: number
} {
  let parsed: Record<string, unknown> = {}
  let rawText = raw

  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) rawText = fenceMatch[1].trim()

  // Try parsing as JSON directly
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Try to extract a JSON object from the text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      let candidate = jsonMatch[0]
      // Repair common LLM JSON mistakes:
      // 1. Fix "key",":" "value" → "key": "value"
      candidate = candidate.replace(/"(\w+)"\s*,\s*"\s*:\s*"\s*/g, '"$1": "')
      // 2. Fix "key",":" value → "key": value
      candidate = candidate.replace(/"(\w+)"\s*,\s*"\s*:\s*/g, '"$1": ')
      // 3. Fix trailing commas before } or ]
      candidate = candidate.replace(/,\s*([}\]])/g, '$1')
      // 4. Fix "confidence",": 0.7" → "confidence": 0.7
      candidate = candidate.replace(/"(\w+)"\s*,\s*":\s*([^"{}[\]]+?)"/g, '"$1": $2')

      try {
        parsed = JSON.parse(candidate)
      } catch {
        // Last resort: extract key-value pairs with regex
        const extractStr = (key: string): string => {
          const m = rawText.match(new RegExp(`"${key}"\\s*[:,]\\s*"?:?\\s*"([^"]*)"`, 'i'))
          return m ? m[1] : ''
        }
        const extractArr = (key: string): string[] => {
          const m = rawText.match(new RegExp(`"${key}"\\s*[:,]\\s*\\[([^\\]]*)\\]`, 'i'))
          if (!m) return []
          return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])
        }
        const summary = extractStr('tradeIdeaSummary') || extractStr('summary')
        const setup = extractStr('setupClassification')
        const risk = extractStr('riskManagementFeedback') || extractStr('riskFeedback')
        const recs = extractStr('recommendations')
        const mistakes = extractArr('mistakes')
        const confMatch = rawText.match(/"confidence"\s*[:,"\s]*(\d+\.?\d*)/i)

        if (summary || setup || risk) {
          return {
            summary: summary || raw.trim(),
            mistakes,
            setupClassification: setup || 'unknown',
            riskFeedback: [risk, recs].filter(Boolean).join('\n'),
            confidence: confMatch ? Number(confMatch[1]) : 0.5,
          }
        }
      }
    }
  }

  // Handle array wrapper: some models return [{ ... }]
  if (Array.isArray(parsed) && parsed.length > 0) {
    parsed = parsed[0] as Record<string, unknown>
  }

  const hasStructured = parsed.tradeIdeaSummary || parsed.summary || parsed.setupClassification || parsed.riskManagementFeedback || parsed.riskFeedback
  const summary = hasStructured
    ? String(parsed.tradeIdeaSummary || parsed.summary || 'No summary')
    : (raw.trim() || 'No response from model')
  const setupClassification = hasStructured
    ? String(parsed.setupClassification || parsed.setup || 'unknown')
    : 'unknown'
  const riskFeedback = hasStructured
    ? String(parsed.riskManagementFeedback || parsed.riskFeedback || '')
    : ''
  const recommendations = String(parsed.recommendations || '')

  return {
    summary,
    mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.map(String) : [],
    setupClassification,
    riskFeedback: [riskFeedback, recommendations].filter(Boolean).join('\n'),
    confidence: Number(parsed.confidence) || 0.5,
  }
}

const browserApi = {
  listTrades: async (): Promise<Trade[]> => loadTrades(),

  saveTrade: async (trade: Trade): Promise<Trade> => {
    const trades = loadTrades()
    const idx = trades.findIndex((t) => t.id === trade.id)
    if (idx >= 0) {
      trades[idx] = trade
    } else {
      trades.unshift(trade)
    }
    persistTrades(trades)
    return trade
  },

  deleteTrade: async (id: string): Promise<void> => {
    persistTrades(loadTrades().filter((t) => t.id !== id))
  },

  monthStats: async (_year: number, _month: number): Promise<CalendarDayStat[]> => {
    const trades = loadTrades()
    const map = new Map<string, { count: number; pnl: number }>()
    for (const t of trades) {
      const d = t.openedAt.slice(0, 10)
      const prev = map.get(d) || { count: 0, pnl: 0 }
      map.set(d, { count: prev.count + 1, pnl: prev.pnl + t.pnl })
    }
    return Array.from(map, ([date, v]) => ({ date, trades: v.count, pnl: v.pnl }))
  },

  analytics: async (): Promise<AnalyticsSummary> => {
    const all = loadTrades()
    const wins = all.filter((t) => t.pnl > 0)
    const losses = all.filter((t) => t.pnl < 0)
    const totalPnl = all.reduce((s, t) => s + t.pnl, 0)
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
    const winRate = all.length ? (wins.length / all.length) * 100 : 0
    const riskReward = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0

    // Sort trades chronologically, then build cumulative PnL per day
    const sorted = [...all].sort((a, b) => a.openedAt.localeCompare(b.openedAt))
    const dailyPnl = new Map<string, number>()
    for (const t of sorted) {
      const d = t.openedAt.slice(0, 10)
      dailyPnl.set(d, (dailyPnl.get(d) || 0) + t.pnl)
    }
    let runningBalance = 0
    const equityCurve: { date: string; value: number }[] = []
    for (const [date, dayPnl] of dailyPnl) {
      runningBalance += dayPnl
      equityCurve.push({ date, value: runningBalance })
    }

    return { winRate, avgWin, avgLoss, totalPnl, riskReward, equityCurve }
  },

  // ── Journal ─────────────────────────────────────────────────

  getJournalEntry: async (date: string): Promise<JournalEntry | null> => {
    const entries = loadJournalEntries()
    return entries[date] || null
  },

  saveJournalEntry: async (entry: JournalEntry): Promise<JournalEntry> => {
    const entries = loadJournalEntries()
    entries[entry.date] = entry
    persistJournalEntries(entries)
    return entry
  },

  listJournalEntries: async (): Promise<JournalEntry[]> => {
    const entries = loadJournalEntries()
    return Object.values(entries).sort((a, b) => b.date.localeCompare(a.date))
  },

  // ── AI Analysis ─────────────────────────────────────────────

  analyzeTradeImage: async (tradeId: string, _imagePath: string): Promise<AiAnalysis> => {
    const trades = loadTrades()
    const trade = trades.find((t) => t.id === tradeId)
    if (!trade) throw new Error('Trade not found')
    const img = getPrimaryChartImage(trade.chartImageData)
    if (!img) throw new Error('No chart image to analyze')
    const { mimeType, b64 } = img

    const prompt = [
      `You are an expert forex trading coach analyzing a chart screenshot.`,
      ``,
      `Trade context:`,
      `- Pair: ${trade.pair}`,
      `- Direction: ${trade.direction}`,
      `- Entry: ${trade.entry}`,
      `- Stop Loss: ${trade.stopLoss}`,
      `- Take Profit: ${trade.takeProfit}`,
      `- Risk: ${trade.riskPercent}%`,
      ``,
      `Please analyze the chart and provide:`,
      `1. A summary of the trade idea and what you see on the chart (key levels, patterns, trend)`,
      `2. Any potential mistakes or concerns with this trade setup`,
      `3. What type of setup this is (e.g. breakout, pullback, reversal, range trade, trend continuation)`,
      `4. Risk management feedback (is the stop loss placement good? is the R:R ratio reasonable?)`,
      `5. Any recommendations to improve this trade`,
      ``,
      `Respond with a JSON object using exactly these keys:`,
      `{"tradeIdeaSummary": "...", "mistakes": ["...", "..."], "setupClassification": "...", "riskManagementFeedback": "...", "recommendations": "...", "confidence": 0.7}`,
    ].join('\n')

    const settings = loadSettings()
    let raw: string

    if (settings.aiProvider === 'gemini') {
      raw = await callGemini(settings, prompt, b64, mimeType)
    } else if (settings.aiProvider === 'groq') {
      raw = await callGroq(settings, prompt, b64, mimeType)
    } else {
      raw = await callOllama(settings, prompt, b64)
    }

    // Parse the response
    const result = parseAiResponse(raw)

    return {
      id: crypto.randomUUID(),
      tradeId,
      ...result,
      createdAt: new Date().toISOString(),
    }
  },

  listTradeAnalyses: async (_tradeId: string): Promise<AiAnalysis[]> => {
    return []
  },

  // ── Settings ────────────────────────────────────────────────

  getSettings: async (): Promise<AppSettings> => loadSettings(),

  saveSettings: async (settings: AppSettings): Promise<AppSettings> => {
    persistSettings(settings)
    return settings
  },

  // ── Data Management ─────────────────────────────────────────

  exportAllData: async (): Promise<string> => {
    const trades = loadTrades()
    const journals = loadJournalEntries()
    const settings = loadSettings()
    return JSON.stringify({ trades, journals, settings, exportedAt: new Date().toISOString() }, null, 2)
  },

  exportAccountData: async (accountId: string): Promise<string> => {
    const trades = loadTrades(accountId)
    const journals = loadJournalEntries(accountId)
    const settings = loadSettings()
    return JSON.stringify({ trades, journals, settings, exportedAt: new Date().toISOString() }, null, 2)
  },

  importAllData: async (json: string): Promise<{ trades: number; journals: number }> => {
    const data = JSON.parse(json)
    if (data.trades && Array.isArray(data.trades)) {
      persistTrades(data.trades)
    }
    if (data.journals && typeof data.journals === 'object') {
      persistJournalEntries(data.journals)
    }
    if (data.settings && typeof data.settings === 'object') {
      const currentSettings = loadSettings()
      persistSettings({
        ...DEFAULT_SETTINGS,
        ...currentSettings,
        ...data.settings,
        accounts: currentSettings.accounts,
        activeAccountId: currentSettings.activeAccountId,
      })
    }
    return {
      trades: data.trades?.length || 0,
      journals: Object.keys(data.journals || {}).length,
    }
  },

  clearTrades: async (): Promise<void> => {
    localStorage.removeItem(acctKey(STORAGE_KEY))
  },

  clearJournals: async (): Promise<void> => {
    localStorage.removeItem(acctKey(JOURNAL_KEY))
  },

  clearAllData: async (): Promise<void> => {
    localStorage.removeItem(acctKey(STORAGE_KEY))
    localStorage.removeItem(acctKey(JOURNAL_KEY))
    localStorage.removeItem(SETTINGS_KEY)
    localStorage.removeItem('journal_starting_capital')
  },
}

// ── Tauri native API ────────────────────────────────────────

const tauriApi = {
  listTrades: async (): Promise<Trade[]> => {
    const trades = await invoke<Trade[]>('list_trades', { accountId: getActiveAccountId() })
    return trades.map((t) => {
      const screenshots = parseChartImages(t.chartImageData)
      return { ...t, chartScreenshots: screenshots, chartImageData: screenshots[0] }
    })
  },
  saveTrade: async (trade: Trade): Promise<Trade> => {
    const screenshots = trade.chartScreenshots ?? (trade.chartImageData ? [trade.chartImageData] : [])
    const packed: Trade = {
      ...trade,
      chartImageData: screenshots.length ? JSON.stringify(screenshots) : undefined,
    }
    const saved = await invoke<Trade>('upsert_trade', { trade: packed, accountId: getActiveAccountId() })
    return { ...saved, chartScreenshots: screenshots, chartImageData: screenshots[0] }
  },
  deleteTrade: (id: string) => invoke<void>('delete_trade', { id }),
  monthStats: (year: number, month: number) =>
    invoke<CalendarDayStat[]>('get_calendar_month', { year, month, accountId: getActiveAccountId() }),
  analytics: () => invoke<AnalyticsSummary>('get_analytics', { accountId: getActiveAccountId() }),
  analyzeTradeImage: (tradeId: string, imagePath: string) =>
    invoke<AiAnalysis>('analyze_trade_image', { tradeId, imagePath }),
  listTradeAnalyses: (tradeId: string) => invoke<AiAnalysis[]>('list_trade_analyses', { tradeId }),
  // Journal (fallback to browser for now — Tauri backend doesn't have journal commands yet)
  getJournalEntry: browserApi.getJournalEntry,
  saveJournalEntry: browserApi.saveJournalEntry,
  listJournalEntries: browserApi.listJournalEntries,
  // Settings (localStorage for now)
  getSettings: browserApi.getSettings,
  saveSettings: browserApi.saveSettings,
  exportAllData: browserApi.exportAllData,
  importAllData: browserApi.importAllData,
  clearTrades: browserApi.clearTrades,
  clearJournals: browserApi.clearJournals,
  clearAllData: browserApi.clearAllData,
}

// ── Export: auto-select based on runtime ────────────────────

export const api = isTauri ? tauriApi : browserApi

// ── Supabase-backed API (used when user is authenticated) ───

let _supabaseUserId: string | null = null

export function setSupabaseUserId(userId: string | null) {
  _supabaseUserId = userId
}

function getSupabaseApi() {
  const userId = _supabaseUserId
  if (!userId) throw new Error('Not authenticated')
  const accountId = getActiveAccountId()

  return {
    listTrades: () => dbListTrades(userId, accountId),

    saveTrade: async (trade: Trade): Promise<Trade> => {
      return dbSaveTrade(trade, userId, accountId)
    },

    deleteTrade: (id: string) => dbDeleteTrade(id, userId, accountId),

    monthStats: async (_year: number, _month: number): Promise<CalendarDayStat[]> => {
      const trades = await dbListTrades(userId, accountId)
      const map = new Map<string, { count: number; pnl: number }>()
      for (const t of trades) {
        const d = t.openedAt.slice(0, 10)
        const prev = map.get(d) || { count: 0, pnl: 0 }
        map.set(d, { count: prev.count + 1, pnl: prev.pnl + t.pnl })
      }
      return Array.from(map, ([date, v]) => ({ date, trades: v.count, pnl: v.pnl }))
    },

    analytics: async (): Promise<AnalyticsSummary> => {
      const all = await dbListTrades(userId, accountId)
      const wins = all.filter((t) => t.pnl > 0)
      const losses = all.filter((t) => t.pnl < 0)
      const totalPnl = all.reduce((s, t) => s + t.pnl, 0)
      const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
      const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0
      const winRate = all.length ? (wins.length / all.length) * 100 : 0
      const riskReward = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0

      const sorted = [...all].sort((a, b) => a.openedAt.localeCompare(b.openedAt))
      const dailyPnl = new Map<string, number>()
      for (const t of sorted) {
        const d = t.openedAt.slice(0, 10)
        dailyPnl.set(d, (dailyPnl.get(d) || 0) + t.pnl)
      }
      let runningBalance = 0
      const equityCurve: { date: string; value: number }[] = []
      for (const [date, dayPnl] of dailyPnl) {
        runningBalance += dayPnl
        equityCurve.push({ date, value: runningBalance })
      }

      return { winRate, avgWin, avgLoss, totalPnl, riskReward, equityCurve }
    },

    getJournalEntry: (date: string) => dbGetJournalEntry(userId, accountId, date),
    saveJournalEntry: (entry: JournalEntry) => dbSaveJournalEntry(entry, userId, accountId),
    listJournalEntries: () => dbListJournalEntries(userId, accountId),

    analyzeTradeImage: async (tradeId: string, _imagePath: string): Promise<AiAnalysis> => {
      const trades = await dbListTrades(userId, accountId)
      const trade = trades.find((t) => t.id === tradeId)
      if (!trade) throw new Error('Trade not found')
      const img = getPrimaryChartImage(trade.chartImageData)
      if (!img) throw new Error('No chart image to analyze')
      const { mimeType, b64 } = img

      const prompt = buildAiPrompt(trade)
      const settings = await dbGetSettings(userId)
      let raw: string

      if (settings.aiProvider === 'gemini') {
        raw = await callGemini(settings, prompt, b64, mimeType)
      } else if (settings.aiProvider === 'groq') {
        raw = await callGroq(settings, prompt, b64, mimeType)
      } else {
        raw = await callOllama(settings, prompt, b64)
      }

      const result = parseAiResponse(raw)
      return {
        id: crypto.randomUUID(),
        tradeId,
        ...result,
        createdAt: new Date().toISOString(),
      }
    },

    listTradeAnalyses: async (_tradeId: string): Promise<AiAnalysis[]> => [],

    saveSettings: async (settings: AppSettings) => {
      const saved = await dbSaveSettings(settings, userId)
      persistSettings(saved)
      return saved
    },

    getSettings: async () => {
      const settings = await dbGetSettings(userId)
      persistSettings(settings)
      return settings
    },

    exportAllData: () => dbExportAllData(userId, accountId),
    exportAccountData: (targetAccountId: string) => dbExportAllData(userId, targetAccountId),
    importAllData: async (json: string) => {
      const result = await dbImportAllData(json, userId, accountId)
      const settings = await dbGetSettings(userId)
      persistSettings(settings)
      return result
    },
    clearTrades: () => dbClearTrades(userId, accountId),
    clearJournals: () => dbClearJournals(userId, accountId),
    clearAllData: () => dbClearAllData(userId),
  }
}

/**
 * Get the active API. When a Supabase user is set, uses cloud database.
 * Otherwise falls back to localStorage/Tauri.
 */
export function getApi() {
  if (_supabaseUserId) {
    return getSupabaseApi()
  }
  return api
}

// ── Shared AI prompt builder ────────────────────────────────

function buildAiPrompt(trade: Trade): string {
  return [
    `You are an expert forex trading coach analyzing a chart screenshot.`,
    ``,
    `Trade context:`,
    `- Pair: ${trade.pair}`,
    `- Direction: ${trade.direction}`,
    `- Entry: ${trade.entry}`,
    `- Stop Loss: ${trade.stopLoss}`,
    `- Take Profit: ${trade.takeProfit}`,
    `- Risk: ${trade.riskPercent}%`,
    ``,
    `Please analyze the chart and provide:`,
    `1. A summary of the trade idea and what you see on the chart (key levels, patterns, trend)`,
    `2. Any potential mistakes or concerns with this trade setup`,
    `3. What type of setup this is (e.g. breakout, pullback, reversal, range trade, trend continuation)`,
    `4. Risk management feedback (is the stop loss placement good? is the R:R ratio reasonable?)`,
    `5. Any recommendations to improve this trade`,
    ``,
    `Respond with a JSON object using exactly these keys:`,
    `{"tradeIdeaSummary": "...", "mistakes": ["...", "..."], "setupClassification": "...", "riskManagementFeedback": "...", "recommendations": "...", "confidence": 0.7}`,
  ].join('\n')
}

// ── Journal AI Feedback ─────────────────────────────────────

function buildJournalPrompt(entry: JournalEntry, trades: Trade[]): string {
  const MOOD_LABELS = ['Terrible', 'Bad', 'Neutral', 'Good', 'Great']
  const moodLabel = entry.postMood > 0 ? `${entry.postMood}/5 (${MOOD_LABELS[entry.postMood - 1]})` : 'not rated'

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const winRate = trades.length > 0 ? ((wins.length / trades.length) * 100).toFixed(0) : null
  const avgRR = trades.length > 0
    ? trades.map((t) => {
        const risk = Math.abs(t.entry - t.stopLoss)
        const reward = Math.abs(t.takeProfit - t.entry)
        return risk > 0 ? reward / risk : 0
      }).reduce((a, b) => a + b, 0) / trades.length
    : null

  const tradesBlock = trades.length === 0
    ? 'No trades were logged for this day.'
    : trades.map((t) => {
        const risk = Math.abs(t.entry - t.stopLoss)
        const reward = Math.abs(t.takeProfit - t.entry)
        const rr = risk > 0 ? (reward / risk).toFixed(2) : 'N/A'
        return `  - ${t.pair} ${t.direction} | PnL: $${t.pnl.toFixed(2)} | Risk: ${t.riskPercent}% | R:R ${rr} | Setup: ${t.setup || 'unspecified'} | Tags: ${t.tags.join(', ') || 'none'} | Notes: ${t.notesHtml || 'none'}`
      }).join('\n')

  const summaryBlock = trades.length > 0
    ? `Day summary: ${trades.length} trade(s), $${totalPnl.toFixed(2)} PnL, ${wins.length}W/${losses.length}L${winRate ? `, ${winRate}% win rate` : ''}${avgRR !== null ? `, avg R:R ${avgRR.toFixed(2)}` : ''}.`
    : ''

  return `You are a direct, experienced trading mentor reviewing a trader's daily journal entry. Your job is NOT to be encouraging or generic. Your job is to find the truth in their day — where their thinking was clear, where it was deluded, and where their actions contradicted their words.

You have two sources of truth: what the trader WROTE and what they actually DID (their trade data). Cross-reference them. If they said they followed their plan but their trades show otherwise, say so. If they rated their mood high but had a bad day, question it. If their written reflection is superficial, push deeper.

CRITICAL LANGUAGE RULES — follow these exactly, no exceptions:
1. When referencing something the trader wrote, quote their EXACT words verbatim in double-quotes. Do not paraphrase, rephrase, clean up, or summarise their language.
2. Do not change their terminology. If they say "order block", say "order block". If they say "sniper entry", say "sniper entry".
3. Write in second person ("you", "your"). Never say "the trader".
4. Keep your own language plain and direct. No metaphors, no trading clichés ("stay disciplined", "trust the process"), no motivational phrasing.
5. Every claim you make must be grounded in a specific number or a specific quoted phrase from the journal. No vague generalisations.

=== JOURNAL ENTRY: ${entry.date} ===

PRE-SESSION PLAN:
- Market Bias: ${entry.preBias || 'not set'}
- Session Focus: ${entry.preSession || 'not set'}
- Key Levels/Zones: ${entry.preLevels || 'not written'}
- Trading Plan: ${entry.prePlan || 'not written'}

POST-SESSION REVIEW:
- What went well: ${entry.postWentWell || 'not written'}
- What went wrong: ${entry.postWentWrong || 'not written'}
- Lessons learned: ${entry.postLessons || 'not written'}
- Emotional state: ${moodLabel}
- Grade given: ${entry.postGrade || 'not graded'}

=== ACTUAL TRADE DATA FOR THIS DAY ===
${summaryBlock}
${tradesBlock}

=== YOUR TASK ===

Write your feedback as a JSON object with these exact keys:

{
  "mentor": "A direct 3-5 sentence paragraph. Write like a mentor who has seen everything — no fluff, no praise for ordinary things. Reference specific numbers and words from their journal. If something is off, name it exactly. If something was genuinely good, say what specifically made it good.",
  "contradiction": "If there is a clear contradiction between what they wrote and what they did, describe it in one blunt sentence. Examples: they said they followed their plan but took 4 trades against their stated bias; they graded themselves A but had a losing day with poor R:R. If there is NO real contradiction, return null.",
  "strength": "One specific thing they actually did well today, grounded in the numbers or their writing. Not generic. Must be earned. If nothing stands out, return null.",
  "focusQuestion": "One hard question they should sit with tonight. Not rhetorical. Something that, if they answer it honestly, will make them a better trader. Make it specific to their actual day.",
  "emotionalFlag": "If you detect emotional language in their writing (overconfidence, self-pity, blame, rationalization, rushed thinking), quote the exact phrase and explain in one sentence why it's a flag. If none, return null."
}

Be specific. Be honest. Do not soften the truth to protect feelings. A trader who gets honest feedback improves; one who gets validation stagnates.`
}

async function callGroqText(settings: AppSettings, prompt: string): Promise<string> {
  const apiKey = settings.groqApiKey
  if (!apiKey) throw new Error('Groq API key not set. Go to Settings > AI Configuration.')

  const model = settings.groqModel || DEFAULT_SETTINGS.groqModel
  let resp: Response
  try {
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }),
    })
  } catch {
    throw new Error('Could not connect to Groq API. Check your internet connection.')
  }

  if (!resp.ok) {
    let errMessage = ''
    try { const e = await resp.json(); errMessage = e?.error?.message || '' } catch { /**/ }
    if (resp.status === 401) throw new Error('Invalid Groq API key.')
    if (resp.status === 429) throw new Error('Groq rate limit hit. Wait a moment and try again.')
    throw new Error(`Groq error ${resp.status}: ${errMessage.slice(0, 200)}`)
  }

  const data = await resp.json()
  return data?.choices?.[0]?.message?.content || ''
}

function parseJournalFeedback(raw: string, date: string): JournalAiFeedback {
  let parsed: Record<string, unknown> = {}
  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    parsed = JSON.parse(fence ? fence[1].trim() : raw)
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    try { if (m) parsed = JSON.parse(m[0]) } catch { /**/ }
  }

  return {
    date,
    mentor: String(parsed.mentor || raw.trim() || 'No response generated.'),
    contradiction: parsed.contradiction && parsed.contradiction !== 'null' ? String(parsed.contradiction) : undefined,
    strength: parsed.strength && parsed.strength !== 'null' ? String(parsed.strength) : undefined,
    focusQuestion: String(parsed.focusQuestion || 'What would you do differently if you traded this day again?'),
    emotionalFlag: parsed.emotionalFlag && parsed.emotionalFlag !== 'null' ? String(parsed.emotionalFlag) : undefined,
    createdAt: new Date().toISOString(),
  }
}

export async function analyzeJournalEntry(entry: JournalEntry): Promise<JournalAiFeedback> {
  const settings = loadSettings()
  if (!settings.groqApiKey) throw new Error('Groq API key not set. Add it in Settings > AI Configuration.')

  // Load trades for this date to give the AI real context
  const allTrades = (() => {
    try { return JSON.parse(localStorage.getItem(acctKey(STORAGE_KEY)) || '[]') as Trade[] } catch { return [] }
  })()
  const dayTrades = allTrades.filter((t) => t.openedAt.startsWith(entry.date))

  if (dayTrades.length === 0) throw new Error('NO_TRADES')

  const prompt = buildJournalPrompt(entry, dayTrades)
  const raw = await callGroqText(settings, prompt)
  return parseJournalFeedback(raw, entry.date)
}
