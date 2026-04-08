import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, ColorType, AreaSeries, type IChartApi } from 'lightweight-charts'
import { getApi, loadSettings, persistSettings } from '../../shared/lib/api'
import { useNavigate } from 'react-router-dom'
import type { EquityPoint, AiAnalysis } from '../../shared/types/domain'
import { ProfitabilityGauges } from '../../shared/components/ProfitabilityGauges'
import { TradingHistory } from '../../shared/components/TradingHistory'
import { TradingCalendar } from '../../shared/components/TradingCalendar'
import { useAccount } from '../../shared/contexts/AccountContext'

function loadCapital(): number {
  return loadSettings().startingCapital || 0
}

function EquityCurve({ data }: { data: EquityPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [capital, setCapital] = useState(loadCapital)
  const [capitalInput, setCapitalInput] = useState(capital ? capital.toString() : '')

  const handleCapitalSave = useCallback(() => {
    const val = parseFloat(capitalInput) || 0
    setCapital(val)
    const settings = loadSettings()
    settings.startingCapital = val
    persistSettings(settings)
  }, [capitalInput])

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6b8a7a',
        fontFamily: 'Inter, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(26, 46, 35, 0.5)' },
        horzLines: { color: 'rgba(26, 46, 35, 0.5)' },
      },
      width: containerRef.current.clientWidth,
      height: 280,
      rightPriceScale: {
        borderColor: '#1a2e23',
      },
      timeScale: {
        borderColor: '#1a2e23',
      },
      crosshair: {
        vertLine: { color: 'rgba(34, 197, 94, 0.3)', labelBackgroundColor: '#22c55e' },
        horzLine: { color: 'rgba(34, 197, 94, 0.3)', labelBackgroundColor: '#22c55e' },
      },
    })

    const areaSeries = chart.addSeries(AreaSeries, {
      topColor: 'rgba(34, 197, 94, 0.3)',
      bottomColor: 'rgba(34, 197, 94, 0.02)',
      lineColor: '#22c55e',
      lineWidth: 2,
    })

    // Deduplicate by date (keep last cumulative value per date), offset by capital
    const dateMap = new Map<string, number>()
    for (const pt of data) {
      dateMap.set(pt.date, capital + pt.value)
    }
    const seriesData = Array.from(dateMap, ([time, value]) => ({ time, value }))
      .sort((a, b) => a.time.localeCompare(b.time))

    areaSeries.setData(seriesData as any)

    // Drawdown series: peak-to-trough as a red area line below equity
    let peak = seriesData.length > 0 ? seriesData[0].value : 0
    const drawdownData = seriesData.map((pt) => {
      if (pt.value > peak) peak = pt.value
      const dd = pt.value - peak // negative or zero
      return { time: pt.time, value: dd }
    })

    const hasDrawdown = drawdownData.some((d) => d.value < 0)
    if (hasDrawdown) {
      const ddSeries = chart.addSeries(AreaSeries, {
        priceScaleId: 'drawdown',
        topColor: 'rgba(248, 113, 113, 0.01)',
        bottomColor: 'rgba(248, 113, 113, 0.25)',
        lineColor: '#f87171',
        lineWidth: 1,
      })
      ddSeries.setData(drawdownData as any)
      chart.priceScale('drawdown').applyOptions({
        scaleMargins: { top: 0.75, bottom: 0 },
      })
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
    }
  }, [data, capital])

  return (
    <div className="card equity-card" style={{ marginTop: 16 }}>
      <div className="equity-header">
        <h3>Equity Curve</h3>
        <div className="capital-input-row">
          <span className="label">Starting Capital</span>
          <div className="capital-input-group">
            <span className="capital-prefix">$</span>
            <input
              type="number"
              className="capital-input"
              placeholder="e.g. 50000"
              value={capitalInput}
              onChange={(e) => setCapitalInput(e.target.value)}
              onBlur={handleCapitalSave}
              onKeyDown={(e) => e.key === 'Enter' && handleCapitalSave()}
            />
          </div>
        </div>
      </div>
      {capital > 0 && data.length > 0 && (
        <div className="equity-balance-row">
          <span className="equity-balance-label">Account Balance</span>
          <span className="equity-balance-value">
            ${(capital + (data.length > 0 ? data[data.length - 1].value : 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
          {(() => {
            let peak = capital
            let maxDD = 0
            const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
            for (const pt of sorted) {
              const bal = capital + pt.value
              if (bal > peak) peak = bal
              const dd = peak - bal
              if (dd > maxDD) maxDD = dd
            }
            return maxDD > 0 ? (
              <>
                <span className="equity-balance-label" style={{ marginLeft: 24 }}>Max Drawdown</span>
                <span className="equity-balance-value negative">
                  -${maxDD.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  {capital > 0 ? ` (${((maxDD / capital) * 100).toFixed(1)}%)` : ''}
                </span>
              </>
            ) : null
          })()}
        </div>
      )}
      {data.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: '30px 0' }}>
          No equity data yet. Add some trades to see your curve.
        </p>
      ) : (
        <div ref={containerRef} />
      )}
    </div>
  )
}

/* ── Chart Image Lightbox ─────────────────────────────────── */

function ChartLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>&times;</button>
        <img src={src} alt={alt} className="lightbox-img" />
      </div>
    </div>
  )
}

/* ── AI Analysis Modal ────────────────────────────────────── */

function AiModal({ pair, analysis, onClose }: { pair: string; analysis: AiAnalysis; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const confidencePct = Math.round(analysis.confidence * 100)
  const confidenceColor =
    confidencePct >= 75 ? 'var(--positive)' :
    confidencePct >= 50 ? 'var(--accent)' :
    'var(--negative)'

  return (
    <div className="ai-modal-backdrop" onClick={onClose}>
      <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ai-modal-header">
          <div className="ai-modal-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h3 className="ai-modal-title">AI Analysis</h3>
            <span className="ai-modal-pair">{pair}</span>
          </div>
          <button className="ai-modal-close" onClick={onClose} title="Close">×</button>
        </div>

        {/* Badges row */}
        <div className="ai-modal-badges">
          {analysis.setupClassification && analysis.setupClassification !== 'unknown' && (
            <span className="trade-ai-badge setup">{analysis.setupClassification}</span>
          )}
          <span className="ai-modal-confidence" style={{ color: confidenceColor }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {confidencePct}% confidence
          </span>
        </div>

        {/* Summary */}
        <div className="ai-modal-section">
          <p className="ai-modal-section-label">Summary</p>
          <p className="ai-modal-body">{analysis.summary}</p>
        </div>

        {/* Risk feedback */}
        {analysis.riskFeedback && (
          <div className="ai-modal-section">
            <p className="ai-modal-section-label">Risk Feedback</p>
            <p className="ai-modal-body">{analysis.riskFeedback}</p>
          </div>
        )}

        {/* Mistakes */}
        {analysis.mistakes.length > 0 && (
          <div className="ai-modal-section">
            <p className="ai-modal-section-label">Mistakes Identified</p>
            <div className="ai-modal-mistakes">
              {analysis.mistakes.map((m, i) => (
                <span key={i} className="trade-ai-badge mistake">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3 }}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="ai-modal-timestamp">
          Generated {new Date(analysis.createdAt).toLocaleString()}
        </p>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const q = useQueryClient()
  const navigate = useNavigate()
  const { refreshKey } = useAccount()
  const analytics = useQuery({ queryKey: ['analytics', refreshKey], queryFn: () => getApi().analytics() })
  const trades = useQuery({ queryKey: ['trades', refreshKey], queryFn: () => getApi().listTrades() })
  const [lightboxImg, setLightboxImg] = useState<{ src: string; alt: string } | null>(null)
  const [aiModal, setAiModal] = useState<{ pair: string; analysis: AiAnalysis } | null>(null)

  const handleDelete = (id: string) => {
    getApi().deleteTrade(id).then(() => {
      q.invalidateQueries({ queryKey: ['trades'] })
      q.invalidateQueries({ queryKey: ['analytics'] })
    })
  }

  return (
    <>
      {lightboxImg && (
        <ChartLightbox src={lightboxImg.src} alt={lightboxImg.alt} onClose={() => setLightboxImg(null)} />
      )}
      {aiModal && (
        <AiModal pair={aiModal.pair} analysis={aiModal.analysis} onClose={() => setAiModal(null)} />
      )}

      {/* Metrics row */}
      <div className="grid">
        <article className="card">
          <h3>Win Rate</h3>
          <p className="metric">{(analytics.data?.winRate ?? 0).toFixed(1)}%</p>
        </article>
        <article className="card">
          <h3>Total PnL</h3>
          <p className="metric">${(analytics.data?.totalPnl ?? 0).toFixed(2)}</p>
        </article>
        <article className="card">
          <h3>Avg Win</h3>
          <p className="metric positive">${(analytics.data?.avgWin ?? 0).toFixed(2)}</p>
        </article>
        <article className="card">
          <h3>Avg Loss</h3>
          <p className="metric negative">${(analytics.data?.avgLoss ?? 0).toFixed(2)}</p>
        </article>
      </div>

      {/* Profitability gauges */}
      <ProfitabilityGauges trades={trades.data ?? []} />

      {/* Equity curve */}
      <EquityCurve data={analytics.data?.equityCurve ?? []} />

      {/* Trading calendar */}
      <TradingCalendar trades={trades.data ?? []} />

      {/* Trading history table */}
      <TradingHistory trades={trades.data ?? []} />

      {/* Trade log */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ color: 'var(--text-bright)', fontFamily: 'Sora, sans-serif', fontSize: 18 }}>
            Trade Log
          </h3>
          <button className="btn-primary" onClick={() => navigate('/trades')}>
            + New Trade
          </button>
        </div>

        {trades.isLoading && <p className="muted">Loading trades...</p>}

        {!trades.isLoading && (trades.data ?? []).length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p className="muted">No trades logged yet. Start by creating your first trade.</p>
            <button className="btn-primary" style={{ marginTop: 14 }} onClick={() => navigate('/trades')}>
              Log Your First Trade
            </button>
          </div>
        )}

        <div className="table">
          {(trades.data ?? []).map((t) => (
            <div key={t.id} className="table-row-detail table-btn">
              <div className="trade-row-main">
                <div className="trade-row-info">
                  <span className="trade-pair">{t.pair}</span>
                  <span className={`trade-direction ${t.direction.toLowerCase()}`}>{t.direction}</span>
                  <span className="trade-status">{t.status}</span>
                </div>
                {t.tags.length > 0 && (
                  <div className="trade-row-info">
                    {t.tags.map((tag) => (
                      <span key={tag} className="trade-tag">{tag}</span>
                    ))}
                  </div>
                )}
                {t.setup && !t.tags.length && <span className="trade-tag">{t.setup}</span>}
                <span className={`trade-pnl ${t.pnl >= 0 ? 'positive' : 'negative'}`}>
                  ${t.pnl.toFixed(2)}
                </span>
              </div>
              {(t.chartImageData || t.chartLink) && (
                <div className="trade-chart-wrapper">
                  {t.chartImageData ? (
                    <>
                      <img src={t.chartImageData} className="trade-row-chart" alt={`${t.pair} chart`} />
                      <button
                        className="chart-popout-btn"
                        title="View full chart"
                        onClick={() => setLightboxImg({ src: t.chartImageData!, alt: `${t.pair} chart` })}
                      >
                        &#x26F6;
                      </button>
                    </>
                  ) : (
                    <a
                      href={t.chartLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chart-link-card"
                    >
                      <span className="chart-link-card-icon">&#128247;</span>
                      View Chart
                    </a>
                  )}
                </div>
              )}
              {t.notesHtml && (
                <p className="trade-row-notes">{t.notesHtml}</p>
              )}
              {t.aiAnalysis && (
                <button
                  className="trade-ai-toggle-btn"
                  onClick={() => setAiModal({ pair: t.pair, analysis: t.aiAnalysis! })}
                  title="View AI analysis"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  AI Analysis
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
              <div className="trade-row-right">
                <span className="trade-row-date">
                  {new Date(t.openedAt).toLocaleDateString()}
                </span>
                <button className="mini-btn" onClick={() => navigate('/trades', { state: { trade: t } })}>Edit</button>
                <button className="mini-btn delete-btn" onClick={() => handleDelete(t.id)}>Del</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
