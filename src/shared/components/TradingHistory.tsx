import type { Trade } from '../types/domain'

export function TradingHistory({ trades }: { trades: Trade[] }) {
  const sorted = [...trades].sort((a, b) => b.openedAt.localeCompare(a.openedAt))

  return (
    <div className="card trading-history-card">
      <div className="trading-history-header">
        <h3>Trading History</h3>
        <span className="record-count">{trades.length} records</span>
      </div>

      {trades.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: '30px 0' }}>
          No trades logged yet.
        </p>
      ) : (
        <div className="trading-history-scroll">
          <table className="trading-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Net PnL</th>
                <th>Lot Size</th>
                <th>Commission</th>
                <th>Entry</th>
                <th>Stop Loss</th>
                <th>Take Profit</th>
                <th>Risk %</th>
                <th>Win %</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const isDirectPnl = t.lotSize === 0 && t.entry === 0 && t.stopLoss === 0 && t.takeProfit === 0
                const commission = t.enableCommission ? t.commissionPerLot * t.lotSize : 0
                const isWin = t.pnl > 0
                return (
                  <tr key={t.id}>
                    <td>{new Date(t.openedAt).toLocaleDateString()}</td>
                    <td><span className="hist-symbol-badge">{t.pair}</span></td>
                    <td>
                      <span className={`dir-badge ${t.direction.toLowerCase()}`}>
                        {t.direction}
                      </span>
                    </td>
                    <td className={isWin ? 'positive' : 'negative'}>
                      ${t.pnl.toFixed(2)}
                    </td>
                    <td>{isDirectPnl ? <span className="hist-na">—</span> : t.lotSize.toFixed(2)}</td>
                    <td>{isDirectPnl ? <span className="hist-na">—</span> : `$${commission.toFixed(2)}`}</td>
                    <td>{isDirectPnl ? <span className="hist-na">—</span> : t.entry}</td>
                    <td>{isDirectPnl ? <span className="hist-na">—</span> : t.stopLoss}</td>
                    <td>{isDirectPnl ? <span className="hist-na">—</span> : t.takeProfit}</td>
                    <td>{isDirectPnl ? <span className="hist-na">—</span> : `${t.riskPercent}%`}</td>
                    <td>
                      <span className={`result-badge ${isWin ? 'win' : 'loss'}`}>
                        {isWin ? '100%' : '0%'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
