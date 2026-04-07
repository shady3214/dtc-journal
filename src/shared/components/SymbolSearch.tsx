import { useState, useRef, useEffect, useCallback } from 'react'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

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

const TYPE_FILTERS = ['All', 'Forex', 'Crypto', 'Stock', 'Index', 'Futures'] as const

export function SymbolSearch({ value, onChange, placeholder }: Props) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<SymbolResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>('All')
  const [highlightIdx, setHighlightIdx] = useState(-1)
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

      const mapped: SymbolResult[] = (data as any[]).slice(0, 30).map((item: any) => ({
        symbol: stripHtml(item.symbol || ''),
        description: stripHtml(item.description || ''),
        type: item.type || '',
        exchange: item.exchange || '',
      }))
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

  const handleSelect = (r: SymbolResult) => {
    const sym = r.symbol.replace('/', '')
    setQuery(sym)
    onChange(sym, r)
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
      handleSelect(results[highlightIdx])
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
        onFocus={() => { if (query.length >= 1) { setOpen(true); search(query, activeFilter) } }}
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

          {/* Column headers */}
          <div className="symbol-list-header">
            <span>Symbol</span>
            <span>Description</span>
            <span style={{ textAlign: 'right' }}>Type</span>
          </div>

          {/* Results */}
          <div className="symbol-list">
            {loading && <div className="symbol-list-empty">Searching...</div>}
            {!loading && results.length === 0 && query.length >= 1 && (
              <div className="symbol-list-empty">No results found</div>
            )}
            {!loading && results.map((r, i) => (
              <button
                key={`${r.exchange}:${r.symbol}-${i}`}
                className={`symbol-list-item ${i === highlightIdx ? 'highlighted' : ''}`}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setHighlightIdx(i)}
                type="button"
              >
                <span className="symbol-list-sym">{r.symbol}</span>
                <span className="symbol-list-desc">{r.description}</span>
                <span className="symbol-list-meta">
                  <span className="symbol-type-badge">{typeLabel(r.type)}</span>
                  <span className="symbol-exchange">{r.exchange}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
