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
 * Fetch the live price for a symbol via Yahoo Finance (proxied through Vite).
 * Tries multiple ticker formats if the first attempt fails.
 */
export async function fetchLivePrice(symbol: string, meta?: SymbolResult): Promise<number | null> {
  const candidates = buildTickerCandidates(symbol, meta)

  for (const ticker of candidates) {
    const price = await tryFetchPrice(ticker)
    if (price !== null) return price
  }

  return null
}

async function tryFetchPrice(ticker: string): Promise<number | null> {
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
      return price
    }
    return null
  } catch {
    return null
  }
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
    // 6 uppercase letters = likely a forex pair
    if (sym.length === 6 && /^[A-Z]+$/.test(sym)) {
      // Check commodity map
      if (COMMODITY_MAP[sym]) {
        candidates.push(COMMODITY_MAP[sym])
      }
      candidates.push(`${sym}=X`)
    } else {
      // Probably a stock ticker
      candidates.push(sym)
    }
  }

  // 4. Always add forex fallback as last resort for 6-char symbols
  if (sym.length === 6 && /^[A-Z]+$/.test(sym) && !candidates.includes(`${sym}=X`)) {
    candidates.push(`${sym}=X`)
  }

  return candidates
}
