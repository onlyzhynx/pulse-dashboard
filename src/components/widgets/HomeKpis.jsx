import { useState, useEffect } from 'react'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

// ── A single stat tile ────────────────────────────────────────
function Kpi({ label, value, sub, subColor, accent }) {
  return (
    <div className="widget-card kpi-tile" style={{
      padding: '16px 18px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px',
      // Hero tile: soft green fill + green left edge marker (no outline box)
      ...(accent ? {
        background: 'var(--accent-dim)',
        boxShadow: 'inset 2px 0 0 var(--accent)',
      } : {}),
      minWidth: 0,
    }}>
      <div style={{
        fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap',
      }}>{label}</div>
      <div className="blur-value" style={{
        fontFamily: 'var(--font-num)', fontWeight: 600, lineHeight: 1,
        fontSize: accent ? 'clamp(1.3rem, 1.9vw, 1.9rem)' : 'clamp(1.05rem, 1.5vw, 1.45rem)',
        color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
      {sub && (
        <div className="blur-value" style={{ fontSize: '13px', color: subColor || 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function HomeKpis() {
  const { currency, fromUSD, rates } = useCurrency()
  const [nw, setNw]         = useState(null)   // /api/networth
  const [accounts, setAcc] = useState([])
  const [monthly, setMonthly] = useState(null) // /api/bank/monthly

  useEffect(() => {
    const load = () => {
      fetch('/api/networth').then(r => r.json()).then(setNw).catch(() => {})
      fetch('/api/bank/accounts').then(r => r.ok ? r.json() : { accounts: [] })
        .then(d => setAcc(d.accounts || [])).catch(() => {})
      fetch('/api/bank/monthly').then(r => r.ok ? r.json() : null)
        .then(setMonthly).catch(() => {})
    }
    load()
    const iv = setInterval(load, 60_000)
    return () => clearInterval(iv)
  }, [])

  const usdEur    = rates?.EUR ?? 0.92
  const cryptoUSD = nw?.crypto_usd ?? nw?.total_usd ?? 0
  const bankUSDNative = accounts.filter(a => a.currency === 'USD').reduce((s, a) => s + (a.balance || 0), 0)
  const bankEUR       = accounts.filter(a => a.currency === 'EUR').reduce((s, a) => s + (a.balance || 0), 0)
  const bankInUSD = bankUSDNative + bankEUR / usdEur
  const totalUSD  = cryptoUSD + bankInUSD

  const delta24h    = nw?.delta_24h ?? 0
  const delta24hPct = nw?.delta_24h_pct ?? 0
  const isUp        = delta24h >= 0
  const pctOf = (part) => totalUSD > 0 ? `${(part / totalUSD * 100).toFixed(0)}% of net worth` : null

  const monthName = new Date().toLocaleDateString('en-US', { month: 'long' })
  const spent  = monthly ? Math.abs(monthly.expenses || 0) : 0
  const net    = monthly ? (monthly.net || 0) : 0

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', flexShrink: 0,
    }}>
      <Kpi
        accent
        label="Net Worth"
        value={fmt.currency(fromUSD(totalUSD), currency)}
        sub={`${isUp ? '▲' : '▼'} ${fmt.currency(Math.abs(fromUSD(delta24h)), currency)} (${isUp ? '+' : ''}${delta24hPct.toFixed(2)}%) 24h`}
        subColor={isUp ? 'var(--positive)' : 'var(--negative)'}
      />
      <Kpi
        label="Crypto"
        value={fmt.currency(fromUSD(cryptoUSD), currency)}
        sub={pctOf(cryptoUSD)}
      />
      <Kpi
        label="Bank"
        value={fmt.currency(fromUSD(bankInUSD), currency)}
        sub={pctOf(bankInUSD)}
      />
      <Kpi
        label={`Spent · ${monthName}`}
        value={fmt.currency(fromUSD(spent), currency)}
        sub={monthly ? `net ${fmt.currency(fromUSD(net), currency)}` : null}
        subColor={net >= 0 ? 'var(--positive)' : 'var(--negative)'}
      />
    </div>
  )
}
