import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

import { SERIES_COLORS as COLORS } from '../../utils/colors'

export default function NetWorthWidget() {
  const { currency, fromUSD, rates } = useCurrency()
  const [cryptoUSD, setCryptoUSD]     = useState(0)
  const [delta24h, setDelta24h]       = useState(0)
  const [delta24hPct, setDelta24hPct] = useState(0)
  const [wallets, setWallets]         = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading]         = useState(true)
  const [view, setView]               = useState('list') // 'list' | 'pie'

  useEffect(() => {
    const loadNetworth = () =>
      fetch('/api/networth')
        .then(r => r.json())
        .then(d => {
          setCryptoUSD(d.crypto_usd ?? d.total_usd ?? 0)
          setDelta24h(d.delta_24h ?? 0)
          setDelta24hPct(d.delta_24h_pct ?? 0)
          setLoading(false)
        })
        .catch(() => setLoading(false))

    const loadWallets = () =>
      fetch('/api/wallets/snapshot')
        .then(r => r.ok ? r.json() : { wallets: [] })
        .then(d => setWallets(d.wallets || []))
        .catch(() => {})

    const loadBank = () =>
      fetch('/api/bank/accounts')
        .then(r => r.ok ? r.json() : { accounts: [] })
        .then(d => setBankAccounts(d.accounts || []))
        .catch(() => {})

    loadNetworth(); loadWallets(); loadBank()
    const iv = setInterval(() => { loadNetworth(); loadWallets(); loadBank() }, 60_000)
    return () => clearInterval(iv)
  }, [])

  // ── Totals ────────────────────────────────────────────────────────────
  const usdEur        = rates.EUR ?? 0.92
  const bankEUR       = bankAccounts.filter(a => a.currency === 'EUR').reduce((s, a) => s + (a.balance || 0), 0)
  const bankUSDNative = bankAccounts.filter(a => a.currency === 'USD').reduce((s, a) => s + (a.balance || 0), 0)
  const bankInUSD     = bankUSDNative + bankEUR / usdEur
  const totalUSD      = cryptoUSD + bankInUSD
  const total         = fromUSD(totalUSD)
  const delta         = fromUSD(delta24h)
  const isUp          = delta >= 0

  // ── Pie slices: each wallet + each bank account ───────────────────────
  const pieSlices = [
    // Individual wallets (use total_usd from last refresh)
    ...wallets
      .filter(w => w.enabled !== 0 && (w.total_usd || 0) > 0)
      .map(w => ({
        name: w.label || w.address?.slice(0, 8) || w.network,
        sublabel: w.network,
        value_usd: w.total_usd || 0,
        type: 'wallet',
      })),
    // Bank accounts
    ...bankAccounts
      .filter(a => (a.balance || 0) > 0)
      .map(a => ({
        name: a.name || a.bank || 'Bank',
        sublabel: a.currency,
        value_usd: a.currency === 'EUR' ? (a.balance || 0) / usdEur : (a.balance || 0),
        type: 'bank',
      })),
  ].filter(s => s.value_usd > 0)
   .sort((a, b) => b.value_usd - a.value_usd)

  const pieTotal = pieSlices.reduce((s, x) => s + x.value_usd, 0) || totalUSD

  // ── Breakdown list (for list view) ───────────────────────────────────
  const breakdown = [
    cryptoUSD > 0        && { label: 'Crypto',     value_usd: cryptoUSD },
    bankInUSD - bankUSDNative > 0 && { label: 'Bank (EUR)', value_usd: bankInUSD - bankUSDNative },
    bankUSDNative > 0    && { label: 'Bank (USD)', value_usd: bankUSDNative },
  ].filter(Boolean)

  // ── Tooltip ───────────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const { name, sublabel, value_usd } = payload[0].payload
    const pct = pieTotal > 0 ? (value_usd / pieTotal * 100).toFixed(1) : 0
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        padding: '8px 12px', borderRadius: 'var(--radius)',
        fontFamily: 'var(--font)', fontSize: '14px', color: 'var(--text)',
      }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{name}
          {sublabel && <span style={{ fontSize: '12px', marginLeft: '6px', color: 'var(--text-dim)' }}>{sublabel}</span>}
        </div>
        <div>{fmt.currency(fromUSD(value_usd), currency)}</div>
        <div style={{ fontSize: '12px', color: 'var(--accent)' }}>{pct}%</div>
      </div>
    )
  }

  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    if (percent < 0.06) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    // Truncate long names
    const label = name.length > 10 ? name.slice(0, 9) + '…' : name
    return (
      <text x={x} y={y} fill="var(--text)" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '11px', fontFamily: 'var(--font)', fontWeight: 600 }}>
        {label}
      </text>
    )
  }

  return (
    <Widget
      title="Net Worth"
      subtitle={loading ? '…' : fmt.currency(total, currency)}
      actions={
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => setView('list')} className={view === 'list' ? 'btn-active' : 'btn-ghost'}
            title="List view" style={{ fontSize: '15px', padding: '2px 7px' }}>☰</button>
          <button onClick={() => setView('pie')} className={view === 'pie' ? 'btn-active' : 'btn-ghost'}
            title="Pie chart" style={{ fontSize: '15px', padding: '2px 7px' }}>◔</button>
        </div>
      }
    >
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</div>
      ) : view === 'pie' ? (

        // ── PIE VIEW ──────────────────────────────────────────────────────
        // Total is already in the widget subtitle — no header here, give chart max space
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {pieSlices.length > 0 ? (
            <>
              {/* Chart */}
              <div style={{ height: '200px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieSlices.map(s => ({ ...s, value: s.value_usd }))}
                      cx="50%" cy="50%"
                      innerRadius="28%" outerRadius="70%"
                      paddingAngle={2}
                      dataKey="value"
                      labelLine={false}
                      label={<CustomLabel />}
                    >
                      {pieSlices.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Compact legend — fixed height, scrollable */}
              <div style={{ flexShrink: 0, maxHeight: '38%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
                {pieSlices.map((item, i) => {
                  const pct = pieTotal > 0 ? (item.value_usd / pieTotal * 100).toFixed(1) : 0
                  return (
                    <div key={item.name + i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0' }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <span style={{ fontSize: '13px', color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </span>
                      {item.sublabel && (
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)', flexShrink: 0 }}>{item.sublabel}</span>
                      )}
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-num)', flexShrink: 0 }}>{pct}%</span>
                      <span className="blur-value" style={{ fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--font-num)', flexShrink: 0 }}>
                        {fmt.currency(fromUSD(item.value_usd), currency)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>
              Refresh wallets to populate chart
            </div>
          )}
        </div>

      ) : (

        // ── LIST VIEW ─────────────────────────────────────────────────────
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            {/* Big number */}
            <div className="blur-value" style={{
              fontSize: 'clamp(1.4rem, 2.5vw, 2rem)', fontWeight: 600,
              fontFamily: 'var(--font-num)', letterSpacing: '0.02em',
              color: 'var(--text)', marginBottom: '6px', lineHeight: 1,
            }}>
              {fmt.currency(total, currency)}
            </div>

            {/* 24h delta */}
            <div className="blur-value" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '15px', color: isUp ? 'var(--positive)' : 'var(--negative)' }}>
                {isUp ? '▲' : '▼'} {fmt.currency(Math.abs(delta), currency)}
              </span>
              <span style={{ fontSize: '14px', color: isUp ? 'var(--positive)' : 'var(--negative)' }}>
                ({isUp ? '+' : ''}{delta24hPct.toFixed(2)}%)
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>24h</span>
            </div>
          </div>

          {/* Breakdown bars */}
          {breakdown.length > 0 && (
            <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {breakdown.map(item => {
                const val = fromUSD(item.value_usd)
                const pct = totalUSD > 0 ? (item.value_usd / totalUSD) * 100 : 0
                return (
                  <div key={item.label} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{item.label}</span>
                      <span className="blur-value" style={{ fontSize: '14px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                        {fmt.currency(val, currency)}
                      </span>
                    </div>
                    <div style={{ height: '2px', background: 'var(--border)', borderRadius: '1px', marginTop: '4px' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--chart-line)', borderRadius: '1px', transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Widget>
  )
}
