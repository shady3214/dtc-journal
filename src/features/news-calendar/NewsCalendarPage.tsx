import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '../../shared/lib/api'
import { useAccount } from '../../shared/contexts/AccountContext'
import type { Trade } from '../../shared/types/domain'

// ── Types ──────────────────────────────────────────────────────────

interface FfEvent {
  title: string
  country: string
  date: string
  impact: 'High' | 'Medium' | 'Low' | 'Holiday'
  forecast?: string
  previous?: string
  actual?: string
}

type TabMode = 'events' | 'pnl'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const IMPACT_COLOR: Record<string, string> = {
  High:    '#ef4444',
  Medium:  '#f59e0b',
  Low:     '#3b82f6',
  Holiday: '#60a5fa',
}

const FF_THIS_WEEK = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
const FF_NEXT_WEEK = 'https://nfs.faireconomy.media/ff_calendar_nextweek.json'
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// ── Data fetching ──────────────────────────────────────────────────

async function fetchAllEvents(): Promise<FfEvent[]> {
  const safeJsonFetch = async (url: string): Promise<FfEvent[]> => {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(9000) })
      if (!resp.ok) return []
      const data = await resp.json()
      return Array.isArray(data) ? data as FfEvent[] : []
    } catch {
      return []
    }
  }

  const results: FfEvent[] = []

  // 1) Tauri proxy first (desktop reliability when CORS/WAF blocks direct calls)
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const payload = await invoke<string>('proxy_ff_calendar')
      const parsed = JSON.parse(payload)
      if (Array.isArray(parsed)) results.push(...(parsed as FfEvent[]))
    } catch {
      // Ignore and continue with HTTP fallbacks.
    }
  }

  // 2) Direct ForexFactory endpoints (this week + next week)
  const [directThisWeek, directNextWeek] = await Promise.all([
    safeJsonFetch(FF_THIS_WEEK),
    safeJsonFetch(FF_NEXT_WEEK),
  ])
  results.push(...directThisWeek, ...directNextWeek)

  // 3) Last fallback: local Vercel proxy for this-week data
  // (useful when FF blocks direct requests in browser)
  if (results.length === 0) {
    const proxied = await safeJsonFetch('/api/ff-calendar')
    results.push(...proxied)
  }

  // Deduplicate by date+title+country
  const seen = new Set<string>()
  const all: FfEvent[] = []
  for (const ev of results) {
    const key = `${ev.date}|${ev.title}|${ev.country}`
    if (!seen.has(key)) {
      seen.add(key)
      all.push(ev)
    }
  }

  // Sort so rendering and month bounds are deterministic.
  all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return all
}

// ── Day detail modal ───────────────────────────────────────────────

function DayModal({
  dateStr,
  events,
  pnlData,
  tab,
  onClose,
}: {
  day?: number
  dateStr: string
  events: FfEvent[]
  pnlData?: { pnl: number; trades: number }
  tab: TabMode
  onClose: () => void
}) {
  const label = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  // Sort events by time
  const sorted = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return (
    <div className="ec-modal-backdrop" onClick={handleBackdrop}>
      <div className="ec-modal">
        <div className="ec-modal-header">
          <h3 className="ec-modal-title">{label}</h3>
          <button className="ec-modal-close" onClick={onClose}>×</button>
        </div>

        {tab === 'pnl' && pnlData && (
          <div className="ec-modal-pnl">
            <span className={`ec-modal-pnl-value ${pnlData.pnl >= 0 ? 'positive' : 'negative'}`}>
              {pnlData.pnl >= 0 ? '+' : ''}${pnlData.pnl.toFixed(2)}
            </span>
            <span className="ec-modal-pnl-trades">{pnlData.trades} trade{pnlData.trades !== 1 ? 's' : ''}</span>
          </div>
        )}

        {tab === 'pnl' && !pnlData && (
          <p className="muted" style={{ padding: '16px 0' }}>No trades on this day.</p>
        )}

        {tab === 'events' && sorted.length === 0 && (
          <p className="muted" style={{ padding: '16px 0' }}>No economic events on this day.</p>
        )}

        {tab === 'events' && sorted.length > 0 && (
          <div className="ec-modal-events">
            {sorted.map((ev, i) => {
              const time = new Date(ev.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              const color = IMPACT_COLOR[ev.impact] || '#6b7280'
              return (
                <div key={i} className="ec-modal-event-row">
                  <span className="ec-modal-event-dot" style={{ background: color }} />
                  <div className="ec-modal-event-body">
                    <div className="ec-modal-event-title">
                      <span className="ec-modal-event-country">{ev.country}</span>
                      <span>{ev.title}</span>
                    </div>
                    <div className="ec-modal-event-meta">
                      <span className="ec-modal-event-time">{time}</span>
                      {ev.forecast && <span className="ec-modal-event-stat">Forecast: <b>{ev.forecast}</b></span>}
                      {ev.previous && <span className="ec-modal-event-stat">Previous: <b>{ev.previous}</b></span>}
                      {ev.actual   && <span className="ec-modal-event-stat">Actual: <b>{ev.actual}</b></span>}
                    </div>
                  </div>
                  <span
                    className="ec-impact-badge"
                    style={{ background: color + '22', color, border: `1px solid ${color}55` }}
                  >
                    {ev.impact}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────

export function NewsCalendarPage() {
  const { refreshKey } = useAccount()
  const [tab, setTab] = useState<TabMode>('events')
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDay, setSelectedDay] = useState<{ day: number; dateStr: string } | null>(null)

  const year  = month.getFullYear()
  const mon   = month.getMonth()
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // ForexFactory events
  const eventsQuery = useQuery({
    queryKey: ['ff-events'],
    queryFn: fetchAllEvents,
    staleTime: 2 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 6000),
    refetchOnWindowFocus: true,
  })

  // Trades for PNL tab
  const tradesQuery = useQuery({
    queryKey: ['trades', refreshKey],
    queryFn: () => getApi().listTrades(),
  })

  // Derive navigation bounds from actual loaded event data so the arrows are
  // only enabled for months that genuinely have events. Fall back to the
  // current month while data is still loading.
  const now = new Date()
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const { minMonth, maxMonth } = useMemo(() => {
    const events = eventsQuery.data ?? []
    if (events.length === 0) {
      return { minMonth: currentMonthStart, maxMonth: currentMonthStart }
    }
    let earliest = new Date(8640000000000000)
    let latest   = new Date(-8640000000000000)
    for (const ev of events) {
      const d = new Date(ev.date)
      if (d < earliest) earliest = d
      if (d > latest)   latest   = d
    }
    const mn = new Date(earliest.getFullYear(), earliest.getMonth(), 1)
    const mx = new Date(latest.getFullYear(), latest.getMonth(), 1)
    // Always include current month (needed for PNL tab even with no events)
    return {
      minMonth: mn < currentMonthStart ? mn : currentMonthStart,
      maxMonth: mx > currentMonthStart ? mx : currentMonthStart,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsQuery.data])

  const atMin = month <= minMonth
  const atMax = month >= maxMonth
  const outsideRange = month < minMonth || month > maxMonth

  const prevMonth = () => { if (!atMin) setMonth(new Date(year, mon - 1, 1)) }
  const nextMonth = () => { if (!atMax) setMonth(new Date(year, mon + 1, 1)) }

  // Build calendar grid cells
  const daysInMonth = new Date(year, mon + 1, 0).getDate()
  const firstDay    = new Date(year, mon, 1).getDay()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  // Events grouped by date string "YYYY-MM-DD" — Low impact filtered out
  const eventsByDay = useMemo(() => {
    const map = new Map<string, FfEvent[]>()
    for (const ev of eventsQuery.data ?? []) {
      if (ev.impact === 'Low') continue
      const d = ev.date.slice(0, 10)
      const list = map.get(d) || []
      list.push(ev)
      map.set(d, list)
    }
    return map
  }, [eventsQuery.data])
  const noEventsLoaded = !eventsQuery.isLoading && !eventsQuery.isError && (eventsQuery.data?.length ?? 0) === 0

  // PNL grouped by date string
  const pnlByDay = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: number }>()
    for (const t of (tradesQuery.data as Trade[]) ?? []) {
      const d = t.openedAt.slice(0, 10)
      const prev = map.get(d) || { pnl: 0, trades: 0 }
      map.set(d, { pnl: prev.pnl + t.pnl, trades: prev.trades + 1 })
    }
    return map
  }, [tradesQuery.data])

  const todayStr = new Date().toISOString().slice(0, 10)

  // Keyboard: close modal on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedDay(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleDayClick = useCallback((day: number) => {
    const dateStr = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    setSelectedDay({ day, dateStr })
  }, [year, mon])

  return (
    <div className="ec-page">
      {/* ── Header bar ── */}
      <div className="ec-header card">
        <div className="ec-header-left">
          <h2 className="ec-title">Economic Calendar</h2>
          <div className="ec-tabs">
            <button
              className={`ec-tab ${tab === 'pnl' ? 'active' : ''}`}
              onClick={() => setTab('pnl')}
            >
              PNL
            </button>
            <button
              className={`ec-tab ${tab === 'events' ? 'active' : ''}`}
              onClick={() => setTab('events')}
            >
              Events
            </button>
          </div>
        </div>
        <div className="ec-header-right">
          <span className="ec-month-label">{monthLabel}</span>
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div className="card ec-calendar-card">
        {outsideRange && (
          <div className="ec-range-notice">
            Event data is only available for the current and next week. Navigate back to see events.
          </div>
        )}
        {eventsQuery.isLoading && tab === 'events' && (
          <p className="muted" style={{ padding: '8px 0 12px' }}>Loading economic events…</p>
        )}
        {eventsQuery.isError && tab === 'events' && (
          <p className="muted" style={{ padding: '8px 0 12px', color: 'var(--negative)' }}>
            Could not load ForexFactory calendar. Check your connection.
          </p>
        )}
        {noEventsLoaded && tab === 'events' && (
          <div
            className="card"
            style={{
              marginBottom: 10,
              padding: '10px 12px',
              borderColor: 'var(--danger-border)',
              background: 'var(--danger-bg)',
              color: 'var(--text)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 12 }}>
              News feed returned no events. This is usually temporary — retry now.
            </span>
            <button className="mini-btn" onClick={() => { void eventsQuery.refetch() }}>
              Retry
            </button>
          </div>
        )}

        {/* Day headers */}
        <div className="ec-grid">
          {DAYS.map((d) => (
            <div key={d} className="ec-day-header">{d}</div>
          ))}

          {/* Day cells */}
          {cells.map((day, i) => {
            if (day === null) return <div key={`e${i}`} className="ec-cell ec-cell-empty" />

            const dateStr = `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const events  = eventsByDay.get(dateStr) || []
            const pnlData = pnlByDay.get(dateStr)
            const isToday = dateStr === todayStr

            // Count by impact for badges (Low impact excluded)
            const highCount    = events.filter((e) => e.impact === 'High').length
            const medCount     = events.filter((e) => e.impact === 'Medium').length
            const holidayCount = events.filter((e) => e.impact === 'Holiday').length

            // Cell border color driven by highest impact present
            let borderClass = ''
            if (tab === 'events') {
              if (highCount > 0) borderClass = 'ec-cell-high'
              else if (medCount > 0) borderClass = 'ec-cell-medium'
            } else if (tab === 'pnl' && pnlData) {
              borderClass = pnlData.pnl >= 0 ? 'ec-cell-profit' : 'ec-cell-loss'
            }

            const todayClass = isToday ? 'ec-cell-today' : ''

            // Top 2 events for preview
            const sorted = [...events].sort((a, b) => {
              const order = { High: 0, Medium: 1, Low: 2, Holiday: 3 }
              return (order[a.impact] ?? 3) - (order[b.impact] ?? 3)
            })
            const preview = sorted.slice(0, 2)
            const more    = sorted.length - preview.length

            return (
              <div
                key={day}
                className={`ec-cell ${borderClass} ${todayClass}`}
                onClick={() => handleDayClick(day)}
                title={`${dateStr} — ${events.length} event${events.length !== 1 ? 's' : ''}`}
              >
                <span className="ec-day-num">{day}</span>

                {/* Events tab content */}
                {tab === 'events' && events.length > 0 && (
                  <>
                    {/* Impact dot badges row */}
                    <div className="ec-badges">
                      {highCount > 0 && (
                        <span className="ec-dot-badge" style={{ background: IMPACT_COLOR.High }}>
                          {highCount}
                        </span>
                      )}
                      {medCount > 0 && (
                        <span className="ec-dot-badge" style={{ background: IMPACT_COLOR.Medium }}>
                          {medCount}
                        </span>
                      )}
                      {holidayCount > 0 && (
                        <span className="ec-dot-badge" style={{ background: IMPACT_COLOR.Holiday }}>
                          {holidayCount}
                        </span>
                      )}
                    </div>

                    {/* Preview event titles */}
                    <div className="ec-preview-events">
                      {preview.map((ev, idx) => (
                        <span key={idx} className="ec-preview-event">
                          {ev.country}: {ev.title}
                        </span>
                      ))}
                      {more > 0 && (
                        <span className="ec-preview-more">+{more} more</span>
                      )}
                    </div>
                  </>
                )}

                {/* PNL tab content */}
                {tab === 'pnl' && pnlData && (
                  <div className="ec-pnl-cell">
                    <span className={`ec-pnl-value ${pnlData.pnl >= 0 ? 'positive' : 'negative'}`}>
                      {pnlData.pnl >= 0 ? '+' : ''}${pnlData.pnl.toFixed(2)}
                    </span>
                    <span className="ec-pnl-trades">{pnlData.trades} {pnlData.trades !== 1 ? 'trades' : 'trade'}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Legend ── */}
        <div className="ec-legend">
          {tab === 'events' ? (
            <>
              <span className="ec-legend-item">
                <span className="ec-legend-dot" style={{ background: IMPACT_COLOR.High }} />
                High Impact
              </span>
              <span className="ec-legend-item">
                <span className="ec-legend-dot" style={{ background: IMPACT_COLOR.Medium }} />
                Medium Impact
              </span>
              <span className="ec-legend-item">
                <span className="ec-legend-dot" style={{ background: IMPACT_COLOR.Holiday }} />
                Holiday
              </span>
            </>
          ) : (
            <>
              <span className="ec-legend-item">
                <span className="ec-legend-dot" style={{ background: 'var(--positive)' }} />
                Profitable day
              </span>
              <span className="ec-legend-item">
                <span className="ec-legend-dot" style={{ background: 'var(--negative)' }} />
                Loss day
              </span>
            </>
          )}
          <span className="ec-legend-note muted">
            Data: ForexFactory · This week &amp; next week only
          </span>
        </div>
      </div>

      {/* ── Day detail modal ── */}
      {selectedDay && (
        <DayModal
          day={selectedDay.day}
          dateStr={selectedDay.dateStr}
          events={eventsByDay.get(selectedDay.dateStr) || []}
          pnlData={pnlByDay.get(selectedDay.dateStr)}
          tab={tab}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  )
}
