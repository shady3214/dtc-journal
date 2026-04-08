import { useState, useRef, useEffect, useCallback } from 'react'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const FAV_KEY = 'journal-fav-pairs'
const FAV_META_KEY = 'journal-fav-pairs-meta'

function loadFavs(): string[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] }
}

function saveFavs(favs: string[]) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs))
}

// Store minimal result metadata per sym so we can trigger price fetch from favourites
function loadFavMeta(): Record<string, { type: string; exchange: string }> {
  try { return JSON.parse(localStorage.getItem(FAV_META_KEY) || '{}') } catch { return {} }
}

function saveFavMeta(meta: Record<string, { type: string; exchange: string }>) {
  localStorage.setItem(FAV_META_KEY, JSON.stringify(meta))
}

/** Strip HTML tags like <em>...</em> from TradingView search results */
function stripHtml(str: string): string {
  return str.replace(/<\/?[^>]+(>|$)/g, '')
}

export interface SymbolResult {
  symbol: string
  description: string
  type: string
  exchange: string
}

interface Props {
  value: string
  onChange: (symbol: string, result?: SymbolResult) => void
  placeholder?: string
}

const TYPE_FILTERS = ['All', 'Forex', 'Crypto', 'Index', 'Futures'] as const

// Only show results from these exchanges (case-insensitive match)
const ALLOWED_EXCHANGES = new Set([
  'OANDA', 'FXCM', 'FOREXCOM', 'CME', 'NASDAQ', 'COMEX', 'BINANCE',
])

export function SymbolSearch({ value, onChange, placeholder }: Props) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<SymbolResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>('All')
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [favs, setFavs] = useState<string[]>(loadFavs)
  const [favMeta, setFavMeta] = useState<Record<string, { type: string; exchange: string }>>(loadFavMeta)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Sync external value changes
  useEffect(() => {
    setQuery(value)
  }, [value])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleFav = (sym: string, e: React.MouseEvent, result?: SymbolResult) => {
    e.stopPropagation()
    setFavs((prev) => {
      const next = prev.includes(sym) ? prev.filter((f) => f !== sym) : [...prev, sym]
      saveFavs(next)
      return next
    })
    if (result) {
      setFavMeta((prev) => {
        const next = { ...prev, [sym]: { type: result.type, exchange: result.exchange } }
        saveFavMeta(next)
        return next
      })
    }
  }

  const search = useCallback(async (text: string, typeFilter: string) => {
    if (text.length < 1) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const typeParam = typeFilter === 'All' ? '' : typeFilter.toLowerCase()
      const queryStr = `text=${encodeURIComponent(text)}&hl=1&lang=en&type=${typeParam}&domain=production`
      let data: any[]

      if (isTauri) {
        const { invoke } = await import('@tauri-apps/api/core')
        const text = await invoke<string>('proxy_tv_search', { query: queryStr })
        data = JSON.parse(text)
      } else {
        const resp = await fetch(`/api/tv-search?${queryStr}`)
        if (!resp.ok) throw new Error('Search failed')
        data = await resp.json()
      }

      const mapped: SymbolResult[] = (data as any[]).slice(0, 100).map((item: any) => ({
        symbol: stripHtml(item.symbol || ''),
        description: stripHtml(item.description || ''),
        type: item.type || '',
        exchange: stripHtml(item.exchange || ''),
      })).filter((r) => ALLOWED_EXCHANGES.has(r.exchange.toUpperCase())).slice(0, 30)
      setResults(mapped)
      setHighlightIdx(-1)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInput = (text: string) => {
    setQuery(text)
    setOpen(true)
    // Also update parent immediately so the pair field stays in sync
    onChange(text.toUpperCase())
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(text, activeFilter), 250)
  }

  const handleSelect = (sym: string, result?: SymbolResult) => {
    const clean = sym.replace('/', '')
    setQuery(clean)
    onChange(clean, result)
    setOpen(false)
  }

  const handleFilterClick = (f: string) => {
    setActiveFilter(f)
    search(query, f)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && highlightIdx >= 0 && results[highlightIdx]) {
      e.preventDefault()
      handleSelect(results[highlightIdx].symbol, results[highlightIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const typeLabel = (type: string) => {
    const t = type.toLowerCase()
    if (t.includes('forex') || t.includes('fx') || t === 'cfd') return 'Forex'
    if (t.includes('crypto')) return 'Crypto'
    if (t.includes('stock') || t === 'dr') return 'Stock'
    if (t.includes('index')) return 'Index'
    if (t.includes('futures')) return 'Futures'
    return type || 'Other'
  }

  return (
    <div className="symbol-search" ref={containerRef}>
      <input
        ref={inputRef}
        className="symbol-search-input"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (query.length >= 1) { setOpen(true); search(query, activeFilter) } else { setOpen(true) } }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Search symbol...'}
        autoComplete="off"
        spellCheck={false}
      />

      {open && (
        <div className="symbol-dropdown">
          {/* Type filters */}
          <div className="symbol-filters">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f}
                className={`symbol-filter-btn ${activeFilter === f ? 'active' : ''}`}
                onClick={() => handleFilterClick(f)}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>

          {/* Favourites section */}
          {favs.length > 0 && (
            <div className="symbol-favs-section">
              <div className="symbol-favs-label">Favourites</div>
              <div className="symbol-favs-list">
                {favs.map((sym) => {
                    const meta = favMeta[sym]
                    const result: SymbolResult | undefined = meta
                      ? { symbol: sym, description: '', type: meta.type, exchange: meta.exchange }
                      : undefined
                    return (
                      <button
                        key={sym}
                        className="symbol-fav-chip"
                        onClick={() => handleSelect(sym, result)}
                        type="button"
                      >
                        {sym}
                        <span
                          className="symbol-fav-remove"
                          onClick={(e) => toggleFav(sym, e)}
                          title="Remove from favourites"
                        >
                          ×
                        </span>
                      </button>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Column headers */}
          <div className="symbol-list-header">
            <span></span>
            <span>Symbol</span>
            <span>Description</span>
            <span>Exchange</span>
          </div>

          {/* Results */}
          <div className="symbol-list">
            {loading && <div className="symbol-list-empty">Searching...</div>}
            {!loading && results.length === 0 && query.length >= 1 && (
              <div className="symbol-list-empty">No results found</div>
            )}
            {!loading && query.length < 1 && results.length === 0 && favs.length === 0 && (
              <div className="symbol-list-empty">Type to search symbols…</div>
            )}
            {!loading && results.map((r, i) => {
              const sym = r.symbol.replace('/', '')
              const isFav = favs.includes(sym)
              return (
                <button
                  key={`${r.exchange}:${r.symbol}-${i}`}
                  className={`symbol-list-item ${i === highlightIdx ? 'highlighted' : ''}`}
                  onClick={() => handleSelect(r.symbol, r)}
                  onMouseEnter={() => setHighlightIdx(i)}
                  type="button"
                >
                  <span
                    className={`symbol-fav-btn ${isFav ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleFav(sym, e, r) }}
                    title={isFav ? 'Remove from favourites' : 'Add to favourites'}
                    role="button"
                    tabIndex={-1}
                  >
                    ♥
                  </span>
                  <span className="symbol-list-sym">{r.symbol}</span>
                  <span className="symbol-list-desc">{r.description}</span>
                  <span className="symbol-list-right">
                    <span className="symbol-type-badge">{typeLabel(r.type)}</span>
                    <span className="symbol-exchange">{r.exchange}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
