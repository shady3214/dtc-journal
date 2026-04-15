import type { Trade } from '../types/domain'

/* ── SVG Gauge Arc Helper ──────────────────────────────────── */

function gaugeArcPath(cx: number, cy: number, r: number, t0: number, t1: number): string {
  if (t1 - t0 < 0.001) return ''
  // t goes 0→1 from left to right across a top-facing semicircle (dome)
  const a0 = Math.PI * (1 - t0) // left = PI, right = 0
  const a1 = Math.PI * (1 - t1)
  return [
    `M ${cx + r * Math.cos(a0)} ${cy - r * Math.sin(a0)}`,
    `A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)}`,
  ].join(' ')
}

/* ── Single Gauge Card ─────────────────────────────────────── */

interface GaugeProps {
  title: string
  centerLabel: string
  centerValue: string
  winRate: number
  empty?: boolean
  stats: { label: string; value: string }[]
}

function GaugeCard({ title, centerLabel, centerValue, winRate, empty, stats }: GaugeProps) {
  const cx = 100, cy = 100, r = 70, sw = 12
  const lossRate = Math.max(0, 1 - winRate)

  return (
    <div className="card gauge-card">
      <h3>{title}</h3>
      <svg viewBox="0 0 200 112" className="gauge-svg">
        {/* Track — always visible */}
        <path d={gaugeArcPath(cx, cy, r, 0, 1)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} strokeLinecap="round" />
        {!empty && (
          <>
            {/* Green (wins) — left to winRate */}
            {winRate > 0 && (
              <path d={gaugeArcPath(cx, cy, r, 0, winRate)} fill="none" stroke="#22c55e" strokeWidth={sw} strokeLinecap="butt" />
            )}
            {/* Red (losses) — winRate to right */}
            {lossRate > 0 && (
              <path d={gaugeArcPath(cx, cy, r, winRate, 1)} fill="none" stroke="#f87171" strokeWidth={sw} strokeLinecap="butt" />
            )}
            {/* Round caps on the two outer endpoints only */}
            {winRate > 0 && (
              <circle cx={cx + r * Math.cos(Math.PI)} cy={cy - r * Math.sin(Math.PI)} r={sw / 2} fill="#22c55e" />
            )}
            {lossRate > 0 && (
              <circle cx={cx + r * Math.cos(0)} cy={cy - r * Math.sin(0)} r={sw / 2} fill="#f87171" />
            )}
          </>
        )}
        {/* Center text inside the dome */}
        <text x={cx} y={cy - 24} textAnchor="middle" className="gauge-center-label">{centerLabel}</text>
        <text x={cx} y={cy} textAnchor="middle" className="gauge-center-value">{centerValue}</text>
      </svg>
      <div className="gauge-stats">
        {stats.map((s) => (
          <div key={s.label} className="gauge-stat">
            <span className="gauge-stat-label">{s.label}</span>
            <span className="gauge-stat-value">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Profitability Gauges Row ──────────────────────────────── */

function computeGroup(list: Trade[]) {
  const wins = list.filter((t) => t.pnl > 0)
  const losses = list.filter((t) => t.pnl <= 0)
  const totalPnl = list.reduce((s, t) => s + t.pnl, 0)
  const winPnl = wins.reduce((s, t) => s + t.pnl, 0)
  const lossPnl = losses.reduce((s, t) => s + t.pnl, 0)
  const winRate = list.length ? wins.length / list.length : 0
  return { wins: wins.length, losses: losses.length, totalPnl, winPnl, lossPnl, winRate }
}

const fmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ProfitabilityGauges({ trades }: { trades: Trade[] }) {
  const longs = trades.filter((t) => t.direction.toLowerCase() === 'long')
  const shorts = trades.filter((t) => t.direction.toLowerCase() === 'short')
  const all = computeGroup(trades)
  const lng = computeGroup(longs)
  const sht = computeGroup(shorts)

  return (
    <div className="gauge-row">
      <GaugeCard
        title="Short Analysis"
        centerLabel={shorts.length === 0 ? 'No Shorts' : sht.totalPnl >= 0 ? 'Profit' : 'Loss'}
        centerValue={shorts.length === 0 ? '—' : fmt(sht.totalPnl)}
        winRate={sht.winRate}
        empty={shorts.length === 0}
        stats={[
          { label: `Wins (${sht.wins})`, value: shorts.length === 0 ? '—' : fmt(sht.winPnl) },
          { label: 'Win Rate', value: shorts.length === 0 ? '—' : `${(sht.winRate * 100).toFixed(0)}%` },
          { label: `Losses (${sht.losses})`, value: shorts.length === 0 ? '—' : fmt(sht.lossPnl) },
        ]}
      />
      <GaugeCard
        title="Profitability"
        centerLabel="Total Trades"
        centerValue={String(trades.length)}
        winRate={all.winRate}
        stats={[
          { label: `${(all.winRate * 100).toFixed(2)}%`, value: `Wins: ${all.wins}` },
          { label: `${((1 - all.winRate) * 100).toFixed(2)}%`, value: `Losses: ${all.losses}` },
        ]}
      />
      <GaugeCard
        title="Long Analysis"
        centerLabel={longs.length === 0 ? 'No Longs' : lng.totalPnl >= 0 ? 'Profit' : 'Loss'}
        centerValue={longs.length === 0 ? '—' : fmt(lng.totalPnl)}
        winRate={lng.winRate}
        empty={longs.length === 0}
        stats={[
          { label: `Wins (${lng.wins})`, value: longs.length === 0 ? '—' : fmt(lng.winPnl) },
          { label: 'Win Rate', value: longs.length === 0 ? '—' : `${(lng.winRate * 100).toFixed(0)}%` },
          { label: `Losses (${lng.losses})`, value: longs.length === 0 ? '—' : fmt(lng.lossPnl) },
        ]}
      />
    </div>
  )
}
