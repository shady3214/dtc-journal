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
  postWentWell: string
  postWentWrong: string
  postLessons: string
  postMood: number
  postGrade: string
}

export type ThemeName = 'obsidian' | 'midnight' | 'ember' | 'crimson' | 'phantom'

export interface TradingAccount {
  id: string
  name: string
  capital: number
  description?: string
  createdAt: string
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

  // AI Configuration
  aiProvider: 'groq' | 'gemini' | 'ollama'
  groqApiKey: string
  groqModel: string
  geminiApiKey: string
  geminiModel: string
  ollamaUrl: string
  ollamaModel: string
  ollamaTimeoutSecs: number

  // Preferences
  theme: ThemeName
}
