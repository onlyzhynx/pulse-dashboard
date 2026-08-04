import { useState, useEffect } from 'react'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

const th = { fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 8px', textAlign: 'right', fontWeight: 600 }
const td = { fontSize: '13px', color: 'var(--text)', padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-num)', whiteSpace: 'nowrap' }

export default function HyperliquidWidget() {
  const { currency, fromUSD } = useCurrency()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () => fetch('/api/hyperliquid')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [])

  const cur = (usd) => fmt.currency(fromUSD(usd || 0), currency)
  const accounts = data?.accounts || []
  const hasAny = accounts.length > 0
  const pnl = data?.unrealizedPnl || 0

  return (
    <Widget
      title="Hyperliquid"
      subtitle={hasAny ? `${cur(data.totalValue)} · uPnL ${pnl >= 0 ? '+' : ''}${cur(pnl)}` : undefined}
    >
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</div>
      ) : !hasAny ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6 }}>
          No Hyperliquid account yet. In the <strong>Wallets</strong> panel, add a wallet with
          network <strong>“Hyperliquid (perps)”</strong> and your account address — your positions and
          equity will show up here and count toward net worth.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', height: '100%', overflow: 'auto', maxWidth: '900px' }}>
          {accounts.map(acc => (
            <div key={acc.id}>
              {/* Account header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text)', letterSpacing: '0.04em' }}>{acc.label}</span>
                {acc.ok ? (
                  <span className="blur-value" style={{ fontSize: '15px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                    {cur(acc.accountValue)}
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginLeft: '4px' }}>equity</span>
                  </span>
                ) : (
                  <span style={{ fontSize: '13px', color: 'var(--negative)' }}>fetch error</span>
                )}
              </div>

              {!acc.ok ? (
                <div style={{ fontSize: '12px', color: 'var(--negative)' }}>{acc.error}</div>
              ) : acc.positions?.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No open positions</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ ...th, textAlign: 'left' }}>Coin</th>
                        <th style={th}>Size</th>
                        <th style={th}>Entry</th>
                        <th style={th}>Mark</th>
                        <th style={th}>Liq.</th>
                        <th style={th}>uPnL</th>
                      </tr>
                    </thead>
                    <tbody className="alt-rows">
                      {acc.positions.map(p => {
                        const up = p.unrealizedPnl >= 0
                        const pnlColor = up ? 'var(--positive)' : 'var(--negative)'
                        return (
                          <tr key={p.coin} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ ...td, textAlign: 'left' }}>
                              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{p.coin}</span>
                              <span style={{
                                marginLeft: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
                                padding: '1px 5px', borderRadius: '10px',
                                color: p.side === 'long' ? 'var(--positive)' : 'var(--negative)',
                                background: (p.side === 'long' ? 'var(--positive)' : 'var(--negative)') + '22',
                              }}>{p.side.toUpperCase()}{p.leverage ? ` ${p.leverage}x` : ''}</span>
                            </td>
                            <td style={td}>
                              {fmt.number(p.size, p.size < 1 ? 4 : 2)}
                              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{cur(p.positionValue)}</div>
                            </td>
                            <td style={{ ...td, color: 'var(--text-muted)' }}>{fmt.price(p.entryPx)}</td>
                            <td style={td}>{fmt.price(p.markPx)}</td>
                            <td style={{ ...td, color: 'var(--text-dim)' }}>{p.liquidationPx ? fmt.price(p.liquidationPx) : '—'}</td>
                            <td style={{ ...td, color: pnlColor }}>
                              {up ? '+' : ''}{cur(p.unrealizedPnl)}
                              <div style={{ fontSize: '11px' }}>{up ? '+' : ''}{p.roe.toFixed(1)}%</div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Widget>
  )
}
