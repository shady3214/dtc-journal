export interface Trade {
  id: string
  pair: string
  direction: string
  entry: number
  stopLoss: number
  takeProfit: number
  lotSize: number
  capital: number
  enableCommission: boolean
  commissionPerLot: number
  riskPercent: number
  pnl: number
  returnPercent: number
  status: string
  tags: string[]
  mistakes: string[]
  setup?: string
  chartImageData?: string
  chartScreenshots?: string[]
  chartLink?: string
  notesHtml: string
  openedAt: string
  closedAt?: string
  aiAnalysis?: AiAnalysis
}

export interface CalendarDayStat {
  date: string
  trades: number
  pnl: number
}

export interface EquityPoint {
  date: string
  value: number
}

export interface AnalyticsSummary {
  winRate: number
  avgWin: number
  avgLoss: number
  totalPnl: number
  riskReward: number
  equityCurve: EquityPoint[]
}

export interface AiAnalysis {
  id: string
  tradeId: string
  summary: string
  mistakes: string[]
  setupClassification: string
  riskFeedback: string
  confidence: number
  createdAt: string
}

export interface JournalEntry {
  date: string
  preBias: string
  preSession: string
  preLevels: string
  prePlan: string
  preScreenshots?: string[]        // bias/chart screenshots for pre-session plan
  postWentWell: string
  postWentWrong: string
  postLessons: string
  postMood: number
  postGrade: string
  aiFeedback?: JournalAiFeedback   // persisted after generation (only when trades were logged)
}

export interface JournalAiFeedback {
  date: string
  mentor: string          // direct paragraph — the main coaching response
  contradiction?: string  // if plan vs actual behaviour contradicted, call it out explicitly
  strength?: string       // one specific thing done well (must be grounded in their data)
  focusQuestion: string   // one hard reflective question to sit with
  emotionalFlag?: string  // if emotional language detected, quote it and explain why it's a flag
  createdAt: string
}

export type ThemeName = 'obsidian' | 'midnight' | 'phantom' | 'white' | 'amoled'

export interface TradingAccount {
  id: string
  name: string
  capital: number
  description?: string
  createdAt: string
  // Prop firm mode
  isPropFirm?: boolean
  propMaxDrawdown?: number      // max total loss allowed ($)
  propDailyLoss?: number        // max loss in one calendar day ($)
  propProfitTarget?: number     // profit target ($)
  propConsistencyRule?: number  // max % any single day can be of total profit (e.g. 40)
}

export interface AppSettings {
  // Account
  displayName: string
  startingCapital: number

  // Multi-account
  accounts: TradingAccount[]
  activeAccountId: string

  // Trading Defaults
  defaultCapital: number
  defaultRiskPercent: number
  defaultCommissionPerLot: number
  defaultSession: string
  defaultDirectPnl: boolean

  // AI Configuration
  aiProvider: 'groq' | 'gemini' | 'ollama'
  groqApiKey: string
  groqModel: string
  geminiApiKey: string
  geminiModel: string
  ollamaUrl: string
  ollamaModel: string
  ollamaTimeoutSecs: number

  // Notifications & Alerts
  notificationsEnabled: boolean
  notifyNewsEvents: boolean
  notifyCurrencies: string[]         // e.g. ['USD', 'EUR', 'GBP', 'JPY', 'CAD']
  notifyMinutesBefore: number        // minutes before news to alert
  notifyNyOpen: boolean              // New York 9:30 AM ET alert
  notifyLondonOpen: boolean          // London 8:00 AM GMT alert
  notifyNyOpenMinutesBefore: number  // how many minutes before NY open

  // Preferences
  theme: ThemeName
}
