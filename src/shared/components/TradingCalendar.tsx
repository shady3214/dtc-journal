import { useState, useMemo } from 'react'
import type { Trade } from '../types/domain'

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export function TradingCalendar({ trades }: { trades: Trade[] }) {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const year = month.getFullYear()
  const mon = month.getMonth()
  const daysInMonth = new Date(year, mon + 1, 0).getDate()
  const firstDay = new Date(year, mon, 1).getDay()

  const dailyData = useMemo(() => {
    const map = new Map<number, { pnl: number; wins: number; total: number }>()
    for (const t of trades) {
      const d = new Date(t.openedAt)
      if (d.getFullYear() === year && d.getMonth() === mon) {
        const day = d.getDate()
        const prev = map.get(day) || { pnl: 0, wins: 0, total: 0 }
        map.set(day, {
          pnl: prev.pnl + t.pnl,
          wins: prev.wins + (t.pnl > 0 ? 1 : 0),
          total: prev.total + 1,
        })
      }
    }
    return map
  }, [trades, year, mon])

  const prevMonth = () => setMonth(new Date(year, mon - 1, 1))
  const nextMonth = () => setMonth(new Date(year, mon + 1, 1))

  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="card trading-calendar-card">
      <div className="cal-header">
        <h3>Trading Calendar</h3>
        <div className="cal-nav">
          <button className="mini-btn" onClick={prevMonth}>&larr;</button>
          <span className="cal-month-label">{monthLabel}</span>
          <button className="mini-btn" onClick={nextMonth}>&rarr;</button>
        </div>
      </div>

      <div className="cal-grid">
        {DAYS.map((d) => (
          <div key={d} className="cal-day-header">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} className="cal-cell empty" />
          const data = dailyData.get(day)
          const pnl = data?.pnl ?? 0
          const hasData = !!data
          const winPct = data ? Math.round((data.wins / data.total) * 100) : 0
          const cls = hasData ? (pnl >= 0 ? 'profit' : 'loss') : ''

          return (
            <div key={day} className={`cal-cell ${cls}`}>
              <span className="cal-day-num">{day}</span>
              {hasData && (
                <>
                  <span className={`cal-pnl ${pnl >= 0 ? 'positive' : 'negative'}`}>
                    ${pnl.toFixed(2)}
                  </span>
                  <span className="cal-winpct">{winPct}%</span>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
