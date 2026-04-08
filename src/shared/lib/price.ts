import type { SymbolResult } from '../components/SymbolSearch'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

/**
 * Well-known commodity symbol → Yahoo Finance futures ticker mapping.
 * TradingView uses forex-style names (XAUUSD) while Yahoo uses futures codes (GC=F).
 */
const COMMODITY_MAP: Record<string, string> = {
  XAUUSD: 'GC=F',   // Gold
  XAGUSD: 'SI=F',   // Silver
  XPTUSD: 'PL=F',   // Platinum
  XPDUSD: 'PA=F',   // Palladium
  XAUEUR: 'GC=F',   // Gold (EUR-quoted, approx)
  WTICOUSD: 'CL=F', // WTI Crude Oil
  BCOUSD: 'BZ=F',   // Brent Crude Oil
  USOIL: 'CL=F',    // WTI alias
  UKOIL: 'BZ=F',    // Brent alias
  NGAS: 'NG=F',     // Natural Gas
  NATGAS: 'NG=F',
  COPPER: 'HG=F',
  XCUUSD: 'HG=F',   // Copper
}

/**
 * Determine decimal precision for a symbol, matching TradingView display.
 *  - JPY pairs      → 3 dp  (e.g. 154.321)
 *  - Forex / crypto → 5 dp  (e.g. 1.16846)
 *  - Gold (XAU)     → 3 dp  (e.g. 4,687.215)
 *  - Silver (XAG)   → 4 dp  (e.g. 32.4150)
 *  - Oil / gas      → 3 dp
 *  - Stocks/indices → 2 dp
 */
export function getPricePrecision(symbol: string, type?: string): number {
  const sym = symbol.replace('/', '').toUpperCase()
  const t   = (type || '').toLowerCase()

  if (sym.includes('JPY')) return 3

  if (
    sym.startsWith('XAU') || sym.startsWith('GC') ||  // Gold
    sym === 'GC=F'
  ) return 3

  if (
    sym.startsWith('XAG') || sym === 'SI=F' ||         // Silver
    sym.startsWith('XPT') || sym === 'PL=F' ||         // Platinum
    sym.startsWith('XPD') || sym === 'PA=F'            // Palladium
  ) return 4

  if (
    sym.includes('OIL') || sym === 'CL=F' || sym === 'BZ=F' ||
    sym === 'NG=F' || sym === 'HG=F' ||
    sym.includes('USOIL') || sym.includes('UKOIL') || sym.includes('NGAS')
  ) return 3

  if (t.includes('crypto') || t === 'spot') {
    // BTC/ETH typically 2dp, alts more — default 5 and let Yahoo decide
    return 2
  }

  if (t.includes('stock') || t === 'dr' || t === 'common_stock' || t.includes('index')) return 2

  // Default: forex 5 dp
  return 5
}

/**
 * Fetch the live price for a symbol via Yahoo Finance (proxied through Vite).
 * Uses /v7/finance/quote which returns bid/ask for full pip precision.
 * Falls back to /v8/finance/chart if quote endpoint fails.
 */
export async function fetchLivePrice(symbol: string, meta?: SymbolResult): Promise<number | null> {
  const candidates = buildTickerCandidates(symbol, meta)
  const precision  = getPricePrecision(symbol, meta?.type)

  for (const ticker of candidates) {
    const price = await tryFetchQuote(ticker, precision)
    if (price !== null) return price
  }

  // Fallback: chart endpoint
  for (const ticker of candidates) {
    const price = await tryFetchChart(ticker, precision)
    if (price !== null) return price
  }

  return null
}

/**
 * Use Yahoo /v7/finance/quote — returns bid/ask with full precision.
 */
async function tryFetchQuote(ticker: string, precision: number): Promise<number | null> {
  try {
    const urlPath = `/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=bid,ask,regularMarketPrice`
    let data: any

    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core')
      const text = await invoke<string>('proxy_yf_quote', { urlPath })
      data = JSON.parse(text)
    } else {
      const resp = await fetch(`/api/yf-quote${urlPath}`)
      if (!resp.ok) return null
      data = await resp.json()
    }

    const result = data?.quoteResponse?.result?.[0]
    if (!result) return null

    // Prefer mid of bid/ask for tightest spread precision, fall back to market price
    const bid = result.bid
    const ask = result.ask
    const mid = (typeof bid === 'number' && typeof ask === 'number' && bid > 0 && ask > 0)
      ? (bid + ask) / 2
      : null

    const price = mid ?? result.regularMarketPrice
    if (typeof price === 'number' && price > 0) {
      return roundToPrecision(price, precision)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fallback: /v8/finance/chart endpoint.
 */
async function tryFetchChart(ticker: string, precision: number): Promise<number | null> {
  try {
    const urlPath = `/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`
    let data: any

    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core')
      const text = await invoke<string>('proxy_yf_quote', { urlPath })
      data = JSON.parse(text)
    } else {
      const resp = await fetch(`/api/yf-quote${urlPath}`)
      if (!resp.ok) return null
      data = await resp.json()
    }

    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
    if (typeof price === 'number' && price > 0) {
      return roundToPrecision(price, precision)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Round to a given number of decimal places without floating-point drift.
 */
function roundToPrecision(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

/**
 * Build an ordered list of Yahoo Finance ticker candidates to try.
 * The first match wins.
 */
function buildTickerCandidates(symbol: string, meta?: SymbolResult): string[] {
  const sym = symbol.replace('/', '').toUpperCase()
  const type = (meta?.type || '').toLowerCase()
  const candidates: string[] = []

  // 1. Check commodity map first (XAUUSD → GC=F, etc.)
  if (COMMODITY_MAP[sym]) {
    candidates.push(COMMODITY_MAP[sym])
  }

  // 2. Type-specific mapping
  if (type.includes('commodity') || type === 'cfd') {
    // Already handled by commodity map above; also try as forex
    if (!COMMODITY_MAP[sym]) {
      candidates.push(`${sym}=X`)
    }
  } else if (type.includes('forex') || type === 'fx') {
    candidates.push(`${sym}=X`)
  } else if (type.includes('crypto') || type === 'spot') {
    // BTCUSD → BTC-USD
    const m = sym.match(/^(.+?)(USD|USDT|EUR|GBP|BTC|ETH|JPY|AUD|CAD)$/i)
    if (m) {
      candidates.push(`${m[1]}-${m[2]}`)
    } else {
      candidates.push(`${sym}-USD`)
    }
  } else if (type.includes('futures')) {
    candidates.push(`${sym}=F`)
  } else if (type.includes('stock') || type === 'dr' || type === 'common_stock') {
    candidates.push(sym)
  } else if (type.includes('index')) {
    candidates.push(`^${sym}`)
    candidates.push(sym)
  }

  // 3. Fallback guesses if no type info or nothing matched yet
  if (candidates.length === 0) {
    const isCryptoLike = /^(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|LTC|DOT|AVAX|MATIC|LINK|UNI|ATOM|NEAR|FTM|ALGO|VET|ICP|FIL|SAND|MANA|AXS|SHIB|PEPE|WIF|OP|ARB|SUI|APT|INJ|SEI|TIA|PYTH)/i.test(sym)
    if (isCryptoLike) {
      // Try Yahoo crypto format: BTC-USD, ETH-USD, etc.
      const m = sym.match(/^(.+?)(USD|USDT|EUR|GBP|BTC|ETH)$/i)
      if (m) {
        candidates.push(`${m[1]}-${m[2]}`)
      } else {
        candidates.push(`${sym}-USD`)
      }
    } else if (sym.length === 6 && /^[A-Z]+$/.test(sym)) {
      // 6 uppercase letters with no known crypto prefix = likely a forex pair
      candidates.push(`${sym}=X`)
    } else {
      candidates.push(sym)
    }
  }

  // 4. For confirmed forex/unknown 6-char symbols add =X as last-resort fallback
  // but NOT for crypto symbols (BTC-USD ≠ BTCUSD=X)
  const isCryptoCandidate = candidates.some((c) => c.includes('-') && !c.includes('='))
  if (!isCryptoCandidate && sym.length === 6 && /^[A-Z]+$/.test(sym) && !candidates.includes(`${sym}=X`)) {
    candidates.push(`${sym}=X`)
  }

  return candidates
}
