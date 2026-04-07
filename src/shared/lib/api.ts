import type { AiAnalysis, AnalyticsSummary, AppSettings, CalendarDayStat, JournalEntry, ThemeName, Trade } from '../types/domain'
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

// ── localStorage fallback for browser dev ───────────────────

const STORAGE_KEY = 'journal_trades'
const JOURNAL_KEY = 'journal_entries'
const SETTINGS_KEY = 'journal_settings'

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: '',
  startingCapital: 0,
  defaultCapital: 1000,
  defaultRiskPercent: 1,
  defaultCommissionPerLot: 0,
  defaultSession: '',
  aiProvider: 'groq',
  groqApiKey: '',
  groqModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llava-llama3',
  ollamaTimeoutSecs: 180,
  theme: 'obsidian' as ThemeName,
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    // Migrate legacy theme values
    if (parsed.theme === 'dark' || parsed.theme === 'light') {
      parsed.theme = 'obsidian'
    }
    return parsed
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function persistSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function loadTrades(): Trade[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades))
}

function loadJournalEntries(): Record<string, JournalEntry> {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '{}')
  } catch {
    return {}
  }
}

function persistJournalEntries(entries: Record<string, JournalEntry>) {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries))
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
    if (!trade.chartImageData) throw new Error('No chart image to analyze')

    // Extract base64 data and mime type
    const dataUrlMatch = trade.chartImageData.match(/^data:(image\/\w+);base64,(.+)/)
    const mimeType = dataUrlMatch ? dataUrlMatch[1] : 'image/png'
    const b64 = dataUrlMatch ? dataUrlMatch[2] : trade.chartImageData

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

  importAllData: async (json: string): Promise<{ trades: number; journals: number }> => {
    const data = JSON.parse(json)
    if (data.trades && Array.isArray(data.trades)) {
      persistTrades(data.trades)
    }
    if (data.journals && typeof data.journals === 'object') {
      persistJournalEntries(data.journals)
    }
    if (data.settings && typeof data.settings === 'object') {
      persistSettings({ ...DEFAULT_SETTINGS, ...data.settings })
    }
    return {
      trades: data.trades?.length || 0,
      journals: Object.keys(data.journals || {}).length,
    }
  },

  clearTrades: async (): Promise<void> => {
    localStorage.removeItem(STORAGE_KEY)
  },

  clearJournals: async (): Promise<void> => {
    localStorage.removeItem(JOURNAL_KEY)
  },

  clearAllData: async (): Promise<void> => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(JOURNAL_KEY)
    localStorage.removeItem(SETTINGS_KEY)
    localStorage.removeItem('journal_starting_capital')
  },
}

// ── Tauri native API ────────────────────────────────────────

const tauriApi = {
  listTrades: () => invoke<Trade[]>('list_trades'),
  saveTrade: (trade: Trade) => invoke<Trade>('upsert_trade', { trade }),
  deleteTrade: (id: string) => invoke<void>('delete_trade', { id }),
  monthStats: (year: number, month: number) =>
    invoke<CalendarDayStat[]>('get_calendar_month', { year, month }),
  analytics: () => invoke<AnalyticsSummary>('get_analytics'),
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

  return {
    listTrades: () => dbListTrades(userId),

    saveTrade: async (trade: Trade): Promise<Trade> => {
      return dbSaveTrade(trade, userId)
    },

    deleteTrade: (id: string) => dbDeleteTrade(id),

    monthStats: async (_year: number, _month: number): Promise<CalendarDayStat[]> => {
      const trades = await dbListTrades(userId)
      const map = new Map<string, { count: number; pnl: number }>()
      for (const t of trades) {
        const d = t.openedAt.slice(0, 10)
        const prev = map.get(d) || { count: 0, pnl: 0 }
        map.set(d, { count: prev.count + 1, pnl: prev.pnl + t.pnl })
      }
      return Array.from(map, ([date, v]) => ({ date, trades: v.count, pnl: v.pnl }))
    },

    analytics: async (): Promise<AnalyticsSummary> => {
      const all = await dbListTrades(userId)
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

    getJournalEntry: (date: string) => dbGetJournalEntry(userId, date),
    saveJournalEntry: (entry: JournalEntry) => dbSaveJournalEntry(entry, userId),
    listJournalEntries: () => dbListJournalEntries(userId),

    analyzeTradeImage: async (tradeId: string, _imagePath: string): Promise<AiAnalysis> => {
      const trades = await dbListTrades(userId)
      const trade = trades.find((t) => t.id === tradeId)
      if (!trade) throw new Error('Trade not found')
      if (!trade.chartImageData) throw new Error('No chart image to analyze')

      const dataUrlMatch = trade.chartImageData.match(/^data:(image\/\w+);base64,(.+)/)
      const mimeType = dataUrlMatch ? dataUrlMatch[1] : 'image/png'
      const b64 = dataUrlMatch ? dataUrlMatch[2] : trade.chartImageData

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

    getSettings: () => dbGetSettings(userId),
    saveSettings: (settings: AppSettings) => dbSaveSettings(settings, userId),

    exportAllData: () => dbExportAllData(userId),
    importAllData: (json: string) => dbImportAllData(json, userId),
    clearTrades: () => dbClearTrades(userId),
    clearJournals: () => dbClearJournals(userId),
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
