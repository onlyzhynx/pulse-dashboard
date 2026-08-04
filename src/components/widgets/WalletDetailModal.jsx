import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

export default function WalletDetailModal({ wallet, onClose, onRefresh, refreshing }) {
  const { currency, fromUSD } = useCurrency()
  const [holdings, setHoldings] = useState([])
  const [loading, setLoading] = useState(true)
  const [blacklisted, setBlacklisted] = useState(new Set())
  const [showBlocked, setShowBlocked] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/wallets/${wallet.id}/holdings`)
      .then(r => r.json())
      .then(d => { setHoldings(d.holdings || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [wallet.id])

  const loadBlacklist = useCallback(() => {
    fetch('/api/holdings/blacklist')
      .then(r => r.json())
      .then(d => setBlacklisted(new Set(d.ids || [])))
      .catch(() => {})
  }, [])

  useEffect(() => { load(); loadBlacklist() }, [load, loadBlacklist])

  // Reload after a refresh completes
  const prevRefreshing = useRefPrev(refreshing)
  useEffect(() => {
    if (prevRefreshing && !refreshing) load()
  }, [refreshing, prevRefreshing, load])

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const blockToken = (tokenKey) => {
    fetch('/api/holdings/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tokenKey }),
    }).catch(() => {})
    setBlacklisted(s => new Set([...s, tokenKey]))
    window.dispatchEvent(new CustomEvent('blacklist-updated'))
  }

  const unblockToken = (tokenKey) => {
    fetch(`/api/holdings/blacklist/${encodeURIComponent(tokenKey)}`, { method: 'DELETE' }).catch(() => {})
    setBlacklisted(s => { const n = new Set(s); n.delete(tokenKey); return n })
    window.dispatchEvent(new CustomEvent('blacklist-updated'))
  }

  const visible  = holdings.filter(h => !blacklisted.has(h.token_key))
  const blocked  = holdings.filter(h =>  blacklisted.has(h.token_key))
  const total    = visible.reduce((s, h) => s + (h.holdings_units || 0) * (h.price_usd || 0), 0)

  const cols = '40px 1fr 110px 90px 100px 28px'

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bright)',
          borderRadius: 'var(--radius)',
          width: 'min(92vw, 780px)',
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: 'var(--shadow)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1, marginRight: '12px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', letterSpacing: '0.03em' }}>
              {wallet.label || wallet.address.slice(0, 12) + '…'}
            </div>
            <div style={{
              fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px',
              fontFamily: 'var(--font-num)', letterSpacing: '0.04em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {wallet.address}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '2px', display: 'flex', gap: '8px' }}>
              <span>{wallet.network}</span>
              {wallet.token_count != null && <span>{wallet.token_count} tokens</span>}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', marginRight: '4px' }}>
              {fmt.currency(fromUSD(wallet.total_usd || 0), currency)}
            </div>
            <button onClick={onRefresh} disabled={!!refreshing} title="Refresh wallet"
              className="btn-ghost" style={{ fontSize: '16px', padding: '2px 8px', opacity: refreshing ? 0.5 : 1 }}>
              {refreshing ? '…' : '↻'}
            </button>
            <button onClick={onClose} className="btn-ghost" style={{ fontSize: '16px', padding: '2px 8px' }}>
              ✕
            </button>
          </div>
        </div>

        {/* ── Column headers ── */}
        {!loading && holdings.length > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: cols,
            padding: '6px 18px',
            fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
            color: 'var(--text-dim)', textTransform: 'uppercase',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <span></span>
            <span>Token</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
            <span style={{ textAlign: 'right' }}>Price</span>
            <span style={{ textAlign: 'right' }}>Value</span>
            <span></span>
          </div>
        )}

        {/* ── Token rows ── */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '14px' }}>Loading…</div>
          ) : holdings.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
              No holdings found — try refreshing
            </div>
          ) : (
            <>
              {visible.map((h, i) => (
                <TokenRow key={h.id} h={h} i={i} total={total} cols={cols}
                  isBlocked={false} onBlock={() => blockToken(h.token_key)}
                  currency={currency} fromUSD={fromUSD} />
              ))}

              {blocked.length > 0 && (
                <>
                  <div
                    onClick={() => setShowBlocked(v => !v)}
                    style={{
                      padding: '7px 18px', fontSize: '12px', color: 'var(--text-dim)',
                      borderTop: '1px solid var(--border)', cursor: 'pointer',
                      letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px',
                    }}
                  >
                    <span style={{ fontSize: '10px' }}>{showBlocked ? '▼' : '▶'}</span>
                    {blocked.length} blocked token{blocked.length !== 1 ? 's' : ''}
                  </div>
                  {showBlocked && blocked.map((h, i) => (
                    <TokenRow key={h.id} h={h} i={i} total={total} cols={cols}
                      isBlocked onBlock={() => unblockToken(h.token_key)}
                      currency={currency} fromUSD={fromUSD} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        {!loading && holdings.length > 0 && (
          <div style={{
            padding: '10px 18px', borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
              {visible.length} token{visible.length !== 1 ? 's' : ''}
              {blocked.length > 0 && ` · ${blocked.length} blocked`}
            </span>
            <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
              {fmt.currency(fromUSD(total), currency)}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function TokenRow({ h, i, total, cols, isBlocked, onBlock, currency, fromUSD }) {
  const value = (h.holdings_units || 0) * (h.price_usd || 0)
  const pct   = total > 0 ? (value / total) * 100 : 0

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: cols,
      padding: '9px 18px', alignItems: 'center',
      borderBottom: '1px solid var(--border)',
      opacity: isBlocked ? 0.4 : 1,
    }}>
      <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>#{i + 1}</div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', letterSpacing: '0.03em' }}>
          {h.symbol || '—'}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {h.name || h.address?.slice(0, 14) + '…'}
        </div>
        {!isBlocked && (
          <div style={{ marginTop: '4px', height: '2px', background: 'var(--border)', borderRadius: '1px', width: '80%' }}>
            <div style={{ height: '100%', background: 'var(--accent)', borderRadius: '1px', width: `${Math.min(pct, 100)}%` }} />
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', fontSize: '14px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtAmount(h.holdings_units)}
      </div>

      <div style={{ textAlign: 'right', fontSize: '14px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {h.price_usd ? fmt.price(h.price_usd) : '—'}
      </div>

      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '15px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt.currency(fromUSD(value), currency)}
        </div>
        {!isBlocked && <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{pct.toFixed(1)}%</div>}
      </div>

      {/* Block / unblock */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={onBlock}
          title={isBlocked ? 'Unblock token' : 'Block token'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px',
            color: isBlocked ? 'var(--accent)' : 'var(--text-dim)',
            fontSize: '14px', lineHeight: 1,
          }}
          onMouseEnter={e => e.currentTarget.style.color = isBlocked ? 'var(--accent)' : 'var(--negative)'}
          onMouseLeave={e => e.currentTarget.style.color = isBlocked ? 'var(--accent)' : 'var(--text-dim)'}
        >
          {isBlocked ? '↩' : '⊘'}
        </button>
      </div>
    </div>
  )
}

function useRefPrev(value) {
  const [prev, setPrev] = useState(value)
  useEffect(() => { setPrev(value) }, [value])
  return prev
}

function fmtAmount(n) {
  if (n === null || n === undefined || isNaN(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (n >= 0.0001) return n.toFixed(6)
  return n.toExponential(2)
}
