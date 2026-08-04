import { useState, useEffect } from 'react'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

const th = { fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 8px', textAlign: 'right', fontWeight: 600 }
const td = { fontSize: '13px', color: 'var(--text)', padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-num)', whiteSpace: 'nowrap' }

export default function MeteoraWidget() {
  const { currency, fromUSD } = useCurrency()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () => fetch('/api/meteora')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
    load()
    const iv = setInterval(load, 60_000)
    return () => clearInterval(iv)
  }, [])

  const cur = (usd) => fmt.currency(fromUSD(usd || 0), currency)
  const accounts = (data?.accounts || []).filter(a => !a.ok || a.positions.length > 0)
  const hasAny = accounts.some(a => a.positions?.length > 0)
  const pnl = data?.pnlUsd || 0

  return (
    <Widget
      title="LP Positions"
      subtitle={hasAny ? `${cur(data.totalValue)} · PnL ${pnl >= 0 ? '+' : ''}${cur(pnl)}` : undefined}
    >
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</div>
      ) : !hasAny ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6 }}>
          No open Meteora pool positions found across your Solana wallets.
          DLMM and DAMM v2 positions appear here automatically when you LP.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', height: '100%', overflow: 'auto', maxWidth: '900px' }}>
          {accounts.map(acc => (
            <div key={acc.id}>
              {/* Wallet header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text)', letterSpacing: '0.04em' }}>{acc.label}</span>
                {acc.ok ? (
                  <span className="blur-value" style={{ fontSize: '15px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                    {cur(acc.totalValue)}
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginLeft: '4px' }}>in pools</span>
                  </span>
                ) : (
                  <span style={{ fontSize: '13px', color: 'var(--negative)' }}>fetch error</span>
                )}
              </div>

              {!acc.ok ? (
                <div style={{ fontSize: '12px', color: 'var(--negative)' }}>{acc.error}</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ ...th, textAlign: 'left' }}>Pool</th>
                        <th style={th}>Value</th>
                        <th style={th}>Unclaimed</th>
                        <th style={th}>PnL</th>
                      </tr>
                    </thead>
                    <tbody className="alt-rows">
                      {acc.positions.map(p => {
                        const up = p.pnlUsd >= 0
                        const pnlColor = up ? 'var(--positive)' : 'var(--negative)'
                        return (
                          <tr key={`${p.protocol}-${p.pool}`} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ ...td, textAlign: 'left' }}>
                              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{p.symbol.replace(/ LP$/, '')}</span>
                              <span style={{
                                marginLeft: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
                                padding: '1px 5px', borderRadius: '10px',
                                color: 'var(--accent)', background: 'var(--accent-dim)',
                              }}>{p.protocol.toUpperCase()}</span>
                              {p.outOfRange && (
                                <span style={{
                                  marginLeft: '5px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
                                  padding: '1px 5px', borderRadius: '10px',
                                  color: 'var(--negative)', background: 'var(--negative-dim)',
                                }}>OUT OF RANGE</span>
                              )}
                            </td>
                            <td style={td}><span className="blur-value">{cur(p.valueUsd)}</span></td>
                            <td style={{ ...td, color: p.unclaimedUsd > 0 ? 'var(--positive)' : 'var(--text-dim)' }}>
                              {p.unclaimedUsd > 0 ? cur(p.unclaimedUsd) : '—'}
                            </td>
                            <td style={{ ...td, color: pnlColor }}>
                              {up ? '+' : ''}{cur(p.pnlUsd)}
                              <div style={{ fontSize: '11px' }}>{up ? '+' : ''}{(p.pnlPct || 0).toFixed(1)}%</div>
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
