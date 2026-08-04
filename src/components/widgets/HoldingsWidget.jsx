import { useState, useEffect, useCallback, useRef } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

import { SERIES_COLORS as COLORS } from '../../utils/colors'

const LS_HIDDEN    = 'pulse-holdings-hidden'
const LS_THRESHOLD = 'pulse-holdings-threshold'
const LS_SORT      = 'pulse-holdings-sort'

function loadHidden()    { try { return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN) || '[]')) } catch { return new Set() } }
function saveHidden(s)   { try { localStorage.setItem(LS_HIDDEN, JSON.stringify([...s])) } catch {} }
function loadThreshold() { try { return parseFloat(localStorage.getItem(LS_THRESHOLD) || '1') } catch { return 1 } }

// Sort options — `dir: 1` is each key's natural direction (big/new first, A first)
const SORT_FIELDS = {
  value:  { label: 'SIZE',  cmp: (a, b) => (b.value_usd || 0) - (a.value_usd || 0) },
  units:  { label: 'UNITS', cmp: (a, b) => (b.holdings_units || 0) - (a.holdings_units || 0) },
  price:  { label: 'PRICE', cmp: (a, b) => (b.price_usd || 0) - (a.price_usd || 0) },
  symbol: { label: 'A–Z',   cmp: (a, b) => (a.symbol || a.address || '').localeCompare(b.symbol || b.address || '') },
  newest: { label: 'NEW',   cmp: (a, b) => String(b.first_seen || '').localeCompare(String(a.first_seen || '')) },
}

function loadSort() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SORT) || '{}')
    return { key: SORT_FIELDS[s.key] ? s.key : 'value', dir: s.dir === -1 ? -1 : 1, pin: !!s.pin }
  } catch { return { key: 'value', dir: 1, pin: false } }
}
function saveSort(s) { try { localStorage.setItem(LS_SORT, JSON.stringify(s)) } catch {} }

/** Returns a block explorer URL for a given network + contract address */
function explorerUrl(network, address) {
  if (!address || address === 'native') return null
  const net = (network || '').toLowerCase()
  if (net === 'solana')                       return `https://solscan.io/token/${address}`
  if (net === 'ethereum')                     return `https://etherscan.io/token/${address}`
  if (net === 'base')                         return `https://basescan.org/token/${address}`
  if (net.includes('bnb') || net.includes('bsc')) return `https://bscscan.com/token/${address}`
  if (net.includes('robinhood'))              return `https://robinhoodchain.blockscout.com/token/${address}`
  return null
}

/** Copy text to clipboard — shows a brief ✓ tick */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = (e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button
      onClick={handle}
      title="Copy address"
      style={{
        background: 'transparent', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', color: copied ? 'var(--positive)' : 'var(--text-muted)',
        fontSize: '12px', cursor: 'pointer', padding: '1px 5px', flexShrink: 0,
        transition: 'color 0.2s',
      }}
    >{copied ? '✓' : '⎘'}</button>
  )
}

export default function HoldingsWidget() {
  const { currency, fromUSD } = useCurrency()
  const [holdings, setHoldings]         = useState([])
  const [view, setView]                 = useState('list')
  const [hiddenIds, setHiddenIds]       = useState(loadHidden)
  const [blacklisted, setBlacklisted]   = useState(new Set())
  const [watched, setWatched]           = useState(new Set())
  const [threshold, setThreshold]       = useState(loadThreshold)
  const [sort, setSort]                 = useState(loadSort)
  const [showFilters, setShowFilters]   = useState(false)
  const [showHidden, setShowHidden]     = useState(false)
  const [showBlacklist, setShowBlacklist] = useState(false)
  const [showNoPrice, setShowNoPrice]   = useState(false)
  const [expandedId, setExpandedId]     = useState(null)
  const [filterText, setFilterText]     = useState('')
  const [watchInput, setWatchInput]     = useState('')
  const [tickerDraft, setTickerDraft]   = useState('')
  const [hoverTip, setHoverTip]         = useState(null) // { id, x, y, openUp, data }
  const [expandedInfo, setExpandedInfo] = useState({})   // token_key -> market info
  const infoCache  = useRef(new Map())                   // token_key -> { data, ts }
  const hoverTimer = useRef(null)

  // ── Live market info (price / mcap / liquidity via DexScreener) ───────
  const fetchInfo = useCallback(async (h) => {
    const c = infoCache.current.get(h.id)
    if (c && Date.now() - c.ts < 120_000) return c.data
    const data = await fetch(`/api/holdings/token-info/${encodeURIComponent(h.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
    infoCache.current.set(h.id, { data, ts: Date.now() })
    return data
  }, [])

  const startHover = (e, h) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const openUp = rect.bottom + 150 > window.innerHeight
    const x = Math.min(Math.max(e.clientX - 60, 8), window.innerWidth - 230)
    clearTimeout(hoverTimer.current)
    // Small delay so scanning the list doesn't fire a request per row
    hoverTimer.current = setTimeout(async () => {
      setHoverTip({ id: h.id, h, x, openUp, y: openUp ? rect.top - 6 : rect.bottom + 6, data: undefined })
      const data = await fetchInfo(h)
      setHoverTip(prev => (prev && prev.id === h.id ? { ...prev, data } : prev))
    }, 250)
  }
  const endHover = () => { clearTimeout(hoverTimer.current); setHoverTip(null) }
  useEffect(() => () => clearTimeout(hoverTimer.current), [])

  // ── Data loading ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = () =>
      fetch('/api/holdings/snapshot')
        .then(r => r.ok ? r.json() : null)
        // Meteora LP and Hyperliquid perps pseudo-holdings still count toward
        // totals, but display in their dedicated sections, not the token list.
        .then(d => d && setHoldings((d.holdings || []).filter(h => {
          const n = h.network || ''
          return !n.startsWith('Meteora') && !n.startsWith('Hyperliquid')
        })))
        .catch(() => {})
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const loadBL = () =>
      fetch('/api/holdings/blacklist')
        .then(r => r.ok ? r.json() : { ids: [] })
        .then(d => setBlacklisted(new Set(d.ids || [])))
        .catch(() => {})
    loadBL()
    window.addEventListener('blacklist-updated', loadBL)
    return () => window.removeEventListener('blacklist-updated', loadBL)
  }, [])

  // ── Hide (local, per-device) ──────────────────────────────────────────
  const hideToken = useCallback((id) => {
    setHiddenIds(prev => { const next = new Set(prev); next.add(id); saveHidden(next); return next })
  }, [])
  const unhideToken = useCallback((id) => {
    setHiddenIds(prev => { const next = new Set(prev); next.delete(id); saveHidden(next); return next })
  }, [])
  const clearAllHidden = () => { setHiddenIds(new Set()); saveHidden(new Set()) }

  // ── Blacklist (server-side, all devices) ─────────────────────────────
  const blacklistToken = useCallback((id) => {
    fetch('/api/holdings/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => r.ok && setBlacklisted(prev => new Set([...prev, id])))
    setExpandedId(null)
  }, [])

  const unblacklistToken = useCallback((id) => {
    fetch(`/api/holdings/blacklist/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(r => r.ok && setBlacklisted(prev => { const next = new Set(prev); next.delete(id); return next }))
  }, [])

  // ── Watchlist (server-side): pin a token so it's always shown, never dust ─
  useEffect(() => {
    fetch('/api/holdings/watchlist')
      .then(r => r.ok ? r.json() : { ids: [] })
      .then(d => setWatched(new Set(d.ids || [])))
      .catch(() => {})
  }, [])

  const addWatch = useCallback((raw) => {
    const id = (raw || '').toLowerCase().trim()
    if (!id) return
    fetch('/api/holdings/watchlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    }).then(r => r.ok && setWatched(prev => new Set([...prev, id])))
  }, [])
  const removeWatch = useCallback((id) => {
    fetch(`/api/holdings/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(r => r.ok && setWatched(prev => { const next = new Set(prev); next.delete(id); return next }))
  }, [])

  // Manual ticker override (persists across refreshes for tokens we can't auto-name)
  const renameToken = useCallback((id, symbol) => {
    const s = (symbol || '').trim()
    fetch('/api/holdings/override', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, symbol: s }),
    }).then(r => r.ok && setHoldings(prev => prev.map(h =>
      h.id === id ? { ...h, symbol: s || h.symbol, renamed: s ? 1 : 0 } : h)))
  }, [])

  // ── Threshold ─────────────────────────────────────────────────────────
  const changeThreshold = (val) => {
    const n = parseFloat(val) || 0
    setThreshold(n)
    try { localStorage.setItem(LS_THRESHOLD, String(n)) } catch {}
  }

  // ── Sort ──────────────────────────────────────────────────────────────
  const changeSort = (key) => {
    setSort(prev => {
      // Clicking the active key flips direction; a new key starts natural
      const next = key === prev.key ? { ...prev, dir: -prev.dir } : { ...prev, key, dir: 1 }
      saveSort(next)
      return next
    })
  }
  const togglePinWatched = () => {
    setSort(prev => { const next = { ...prev, pin: !prev.pin }; saveSort(next); return next })
  }

  // ── Watch helpers (match by token_key, contract address, or symbol) ──
  const norm = (s) => (s || '').toLowerCase()
  const isWatched = (h) => watched.has(h.id) ||
    (h.address && watched.has(norm(h.address))) || (h.symbol && watched.has(norm(h.symbol)))
  // Auto-track any holding worth ≥ $20 (always shown, never dust). Manual ★ still
  // works for cheaper tokens; spam with a fake ≥$20 value → just blacklist it.
  const AUTO_TRACK_USD = 20
  const isTracked = (h) => isWatched(h) || (h.value_usd || 0) >= AUTO_TRACK_USD
  const toggleRowWatch = (h) => {
    if (isWatched(h)) {
      [h.id, norm(h.address), norm(h.symbol)].filter(Boolean).forEach(k => { if (watched.has(k)) removeWatch(k) })
    } else {
      addWatch(h.id)
    }
  }
  // Freshly acquired (first seen < 48h ago) — surfaces new memecoin buys.
  const isNew = (h) => {
    if (!h.first_seen) return false
    const t = new Date(String(h.first_seen).replace(' ', 'T') + 'Z').getTime()
    return !isNaN(t) && (Date.now() - t) < 48 * 3600 * 1000
  }

  // ── Derived lists ─────────────────────────────────────────────────────
  const blacklistedTokens = holdings.filter(h => blacklisted.has(h.id))
  const spamTokens  = holdings.filter(h => hiddenIds.has(h.id) && !blacklisted.has(h.id))
  const visible     = holdings
    .filter(h => {
      if (blacklisted.has(h.id) || hiddenIds.has(h.id)) return false
      if (isTracked(h)) return true                   // watched or ≥$20 — always shown
      if (isNew(h) && h.price_usd > 0) return true     // surface fresh priced buys
      // Unpriced tokens (missing/zero price) are mostly spam airdrops — keep them
      // out of the main list and surface them in a collapsible "unpriced" group.
      if (!(h.price_usd > 0)) return false
      return (h.value_usd || 0) >= threshold
    })
    // Membership: keep the 30 largest positions (watched first when pinning),
    // then order that subset by the user's chosen sort.
    .sort((a, b) => {
      if (sort.pin) {
        const aw = isWatched(a) ? 1 : 0, bw = isWatched(b) ? 1 : 0
        if (aw !== bw) return bw - aw
      }
      return (b.value_usd || 0) - (a.value_usd || 0)
    })
    .slice(0, 30)
    .sort((a, b) => {
      if (sort.pin) {
        const aw = isWatched(a) ? 1 : 0, bw = isWatched(b) ? 1 : 0
        if (aw !== bw) return bw - aw
      }
      const f = SORT_FIELDS[sort.key] || SORT_FIELDS.value
      return (f.cmp(a, b) * sort.dir) || (b.value_usd || 0) - (a.value_usd || 0)
    })

  // Held but unpriced — grouped, revealable on demand (not counted in totals).
  const noPriceTokens = holdings.filter(h =>
    !blacklisted.has(h.id) && !hiddenIds.has(h.id) && !isWatched(h) &&
    (h.holdings_units || 0) > 0 && !(h.price_usd > 0)
  )
  const dustCount = holdings.filter(h =>
    !blacklisted.has(h.id) && !hiddenIds.has(h.id) && !isTracked(h) &&
    (h.price_usd > 0) &&  // don't count no-price tokens as dust
    (h.value_usd || 0) > 0 && (h.value_usd || 0) < threshold
  ).length

  const filtered = filterText
    ? visible.filter(h =>
        (h.symbol || '').toLowerCase().includes(filterText.toLowerCase()) ||
        (h.name   || '').toLowerCase().includes(filterText.toLowerCase()))
    : visible

  const total = visible.reduce((s, h) => s + (h.value_usd || 0), 0)

  // ── Pie data ── (always largest-first, independent of the list sort)
  const PIE_LIMIT = 8
  const byValue  = [...visible].sort((a, b) => (b.value_usd || 0) - (a.value_usd || 0))
  const pieTop   = byValue.slice(0, PIE_LIMIT)
  const pieOther = byValue.slice(PIE_LIMIT).reduce((s, h) => s + (h.value_usd || 0), 0)
  const pieData  = [
    ...pieTop.map(h => ({ name: h.symbol || '?', value: h.value_usd || 0, id: h.id })),
    ...(pieOther > 0 ? [{ name: 'Other', value: pieOther }] : []),
  ]

  // ── Sub-components ────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const { name, value } = payload[0].payload
    const pct = total > 0 ? (value / total * 100).toFixed(1) : 0
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        padding: '8px 12px', borderRadius: 'var(--radius)',
        fontFamily: 'var(--font)', fontSize: '14px', color: 'var(--text)',
      }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{name}</div>
        <div>{fmt.currency(fromUSD(value), currency)}</div>
        <div style={{ fontSize: '12px', color: 'var(--accent)' }}>{pct}%</div>
      </div>
    )
  }

  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
    if (percent < 0.05) return null
    const RADIAN = Math.PI / 180
    const r = innerRadius + (outerRadius - innerRadius) * 0.5
    const x = cx + r * Math.cos(-midAngle * RADIAN)
    const y = cy + r * Math.sin(-midAngle * RADIAN)
    return (
      <text x={x} y={y} fill="var(--text)" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '11px', fontFamily: 'var(--font)', fontWeight: 600 }}>
        {name}
      </text>
    )
  }

  const TokenRow = ({ h, isHidden = false, isBlacklistedRow = false }) => {
    const val  = fromUSD(h.value_usd || 0)
    const pct  = total > 0 ? ((h.value_usd || 0) / total) * 100 : 0
    const isExpanded = expandedId === h.id
    const addr = h.address && h.address !== 'native' ? h.address : null
    const expUrl = explorerUrl(h.network, h.address)

    const toggleExpand = (e) => {
      if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return
      endHover()
      if (isExpanded) { setExpandedId(null) }
      else {
        setExpandedId(h.id)
        setTickerDraft(h.symbol || '')
        // Same market stats as the hover card, for the expanded panel (mobile has no hover)
        fetchInfo(h).then(d => setExpandedInfo(prev => ({ ...prev, [h.id]: d })))
      }
    }

    return (
      <div style={{ borderBottom: '1px solid var(--border)', opacity: isHidden || isBlacklistedRow ? 0.5 : 1 }}>
        {/* Main row */}
        <div
          onClick={toggleExpand}
          onMouseEnter={e => startHover(e, h)}
          onMouseLeave={endHover}
          style={{
            padding: '6px 8px', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', gap: '4px',
            cursor: 'pointer',
            background: isExpanded ? 'var(--surface)' : 'transparent',
            borderRadius: isExpanded ? 'var(--radius) var(--radius) 0 0' : 0,
          }}
        >
          {/* Watch / pin */}
          {!isBlacklistedRow && (() => {
            const w = isWatched(h)
            return (
              <button
                onClick={e => { e.stopPropagation(); toggleRowWatch(h) }}
                title={w ? 'Tracked — click to unpin' : 'Track this token (always show)'}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0,
                  fontSize: '14px', padding: '0 2px', lineHeight: 1,
                  color: w ? 'var(--accent)' : 'var(--text-dim)', opacity: w ? 1 : 0.5,
                }}
                onMouseEnter={e => { if (!w) e.currentTarget.style.opacity = '1' }}
                onMouseLeave={e => { if (!w) e.currentTarget.style.opacity = '0.5' }}
              >{w ? '★' : '☆'}</button>
            )
          })()}
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: '14px', color: isHidden || isBlacklistedRow ? 'var(--text-muted)' : 'var(--text)', letterSpacing: '0.05em' }}>
              {h.symbol || addr?.slice(0, 8) || '???'}
              {isNew(h) && (
                <span style={{ marginLeft: '5px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: '8px', padding: '1px 5px' }}>NEW</span>
              )}
              {isBlacklistedRow && <span style={{ fontSize: '11px', color: 'var(--negative)', marginLeft: '4px' }}>BLACKLISTED</span>}
            </span>
            {h.holdings_units > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                {fmt.number(h.holdings_units, 4)}
              </span>
            )}
            {h.network && (
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', marginLeft: '6px' }}>{h.network}</span>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {h.price_usd > 0 ? (
              <>
                <div style={{ fontSize: '14px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                  {fmt.currency(val, currency)}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  ${fmt.number(h.price_usd, h.price_usd < 0.01 ? 6 : 2)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
                ⚠ no price
              </div>
            )}
          </div>

          {/* Hide / unhide button */}
          {isHidden ? (
            <button
              onClick={e => { e.stopPropagation(); unhideToken(h.id) }}
              title="Restore token"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '13px', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--positive)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
            >↩</button>
          ) : !isBlacklistedRow ? (
            <button
              onClick={e => { e.stopPropagation(); hideToken(h.id) }}
              title="Hide token"
              style={{ background: 'transparent', border: 'none', color: 'transparent', fontSize: '13px', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-dim)'}
              onMouseLeave={e => e.currentTarget.style.color = 'transparent'}
            >✕</button>
          ) : null}
        </div>

        {/* Expanded detail panel */}
        {isExpanded && (
          <div style={{
            padding: '8px 10px 10px',
            background: 'var(--surface)',
            borderRadius: '0 0 var(--radius) var(--radius)',
            marginBottom: '2px',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            {/* Contract address row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', flexShrink: 0 }}>
                {h.network === 'Solana' ? 'MINT' : 'CONTRACT'}
              </span>
              {addr ? (
                <>
                  <span style={{
                    fontFamily: 'var(--font-num)', fontSize: '12px',
                    color: 'var(--text-muted)', wordBreak: 'break-all', flex: 1,
                  }}>
                    {addr}
                  </span>
                  <CopyButton text={addr} />
                  {expUrl && (
                    <a
                      href={expUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      title={`View on ${h.network} explorer`}
                      style={{
                        background: 'transparent', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', color: 'var(--text-muted)',
                        fontSize: '12px', cursor: 'pointer', padding: '1px 5px',
                        textDecoration: 'none', flexShrink: 0,
                      }}
                    >↗</a>
                  )}
                </>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>native / unknown</span>
              )}
            </div>

            {/* Market stats (live via DexScreener) */}
            {(() => {
              const d = expandedInfo[h.id]
              if (d === undefined) return null
              if (!d?.found) return null
              const mcap = d.marketCap || d.fdv
              const up = (d.change24h ?? 0) >= 0
              const stat = (label, val, color) => (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '5px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>{label}</span>
                  <span style={{ fontSize: '13px', fontFamily: 'var(--font-num)', color: color || 'var(--text)' }}>{val}</span>
                </span>
              )
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  {d.price > 0 && stat('PRICE', `$${fmt.number(d.price, d.price < 0.01 ? 6 : 2)}`)}
                  {mcap > 0 && stat(d.marketCap ? 'MCAP' : 'FDV', fmt.compact(mcap))}
                  {d.liquidity > 0 && stat('LIQ', fmt.compact(d.liquidity))}
                  {d.change24h != null && stat('24H', `${up ? '+' : ''}${d.change24h.toFixed(2)}%`, up ? 'var(--positive)' : 'var(--negative)')}
                  {d.pairUrl && (
                    <a href={d.pairUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none', letterSpacing: '0.05em' }}>
                      CHART ↗
                    </a>
                  )}
                </div>
              )
            })()}

            {/* Token ID (internal DB id) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', flexShrink: 0 }}>ID</span>
              <span style={{ fontFamily: 'var(--font-num)', fontSize: '12px', color: 'var(--text-dim)', flex: 1, wordBreak: 'break-all' }}>
                {h.id}
              </span>
              <CopyButton text={h.id} />
            </div>

            {/* Ticker override */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', flexShrink: 0 }}>TICKER</span>
              <input
                value={tickerDraft}
                onChange={e => setTickerDraft(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter') { renameToken(h.id, tickerDraft) } }}
                placeholder="set a name…"
                style={{
                  flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '12px', padding: '4px 8px', outline: 'none',
                }}
              />
              <button onClick={e => { e.stopPropagation(); renameToken(h.id, tickerDraft) }}
                className="btn-primary" style={{ fontSize: '11px', padding: '4px 10px' }}>Save</button>
              {h.renamed ? (
                <button onClick={e => { e.stopPropagation(); setTickerDraft(''); renameToken(h.id, '') }}
                  className="btn-ghost" style={{ fontSize: '11px', padding: '4px 8px' }} title="Reset to auto">↺</button>
              ) : null}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {!isBlacklistedRow ? (
                <button
                  onClick={e => { e.stopPropagation(); blacklistToken(h.id) }}
                  style={{
                    background: 'transparent', border: '1px solid var(--negative)',
                    borderRadius: 'var(--radius)', color: 'var(--negative)',
                    fontSize: '12px', cursor: 'pointer', padding: '3px 10px',
                  }}
                >
                  🚫 Blacklist (hide everywhere)
                </button>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); unblacklistToken(h.id) }}
                  style={{
                    background: 'transparent', border: '1px solid var(--positive)',
                    borderRadius: 'var(--radius)', color: 'var(--positive)',
                    fontSize: '12px', cursor: 'pointer', padding: '3px 10px',
                  }}
                >
                  ✓ Remove from blacklist
                </button>
              )}
            </div>
          </div>
        )}

        {/* Value bar — only on normal visible rows */}
        {!isHidden && !isBlacklistedRow && !isExpanded && (
          <div style={{ height: '2px', background: 'var(--border)', borderRadius: '1px', marginTop: '4px' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--chart-line)', borderRadius: '1px', transition: 'width 0.4s ease' }} />
          </div>
        )}
      </div>
    )
  }

  return (
    <Widget
      title="Holdings"
      subtitle={fmt.currency(fromUSD(total), currency)}
      actions={
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {(hiddenIds.size > 0 || blacklisted.size > 0 || dustCount > 0) && (
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              {blacklisted.size > 0 && `${blacklisted.size} blocked`}
              {blacklisted.size > 0 && (hiddenIds.size > 0 || dustCount > 0) && ' · '}
              {hiddenIds.size > 0 && `${hiddenIds.size} hidden`}
              {hiddenIds.size > 0 && dustCount > 0 && ' · '}
              {dustCount > 0 && `${dustCount} dust`}
            </span>
          )}
          <button onClick={() => setView('list')} className={view === 'list' ? 'btn-active' : 'btn-ghost'}
            title="List view" style={{ fontSize: '15px', padding: '2px 7px' }}>☰</button>
          <button onClick={() => setView('pie')} className={view === 'pie' ? 'btn-active' : 'btn-ghost'}
            title="Pie chart" style={{ fontSize: '15px', padding: '2px 7px' }}>◔</button>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={showFilters ? 'btn-active' : 'btn-ghost'}
            title="Filter settings"
            style={{ fontSize: '13px', padding: '2px 7px' }}>⚙</button>
        </div>
      }
    >
      {/* ── Hover card: live price / mcap / liquidity ── */}
      {hoverTip && (
        <div style={{
          position: 'fixed', left: hoverTip.x, top: hoverTip.y, zIndex: 600,
          transform: hoverTip.openUp ? 'translateY(-100%)' : 'none',
          pointerEvents: 'none',
          background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
          borderRadius: '10px', padding: '9px 12px', boxShadow: 'var(--shadow)',
          minWidth: '200px', fontFamily: 'var(--font)',
        }}>
          {(() => {
            const d = hoverTip.data
            const rowPrice = hoverTip.h?.price_usd
            if (d === undefined) return <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>loading…</div>
            if (!d?.found) {
              return (
                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                  {rowPrice > 0 ? `$${fmt.number(rowPrice, rowPrice < 0.01 ? 6 : 2)} · ` : ''}no market data
                </div>
              )
            }
            const mcap = d.marketCap || d.fdv
            const up = (d.change24h ?? 0) >= 0
            const row = (label, val, color) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '1px 0' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>{label}</span>
                <span style={{ fontSize: '13px', fontFamily: 'var(--font-num)', color: color || 'var(--text)' }}>{val}</span>
              </div>
            )
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.05em' }}>
                    {hoverTip.h?.symbol || d.symbol || '?'}
                    <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--text-dim)', marginLeft: '6px' }}>{d.chain}</span>
                  </span>
                  {d.change24h != null && (
                    <span style={{ fontSize: '12px', fontFamily: 'var(--font-num)', color: up ? 'var(--positive)' : 'var(--negative)' }}>
                      {up ? '+' : ''}{d.change24h.toFixed(2)}%
                    </span>
                  )}
                </div>
                {d.price > 0 && row('PRICE', `$${fmt.number(d.price, d.price < 0.01 ? 6 : 2)}`)}
                {mcap > 0 && row(d.marketCap ? 'MCAP' : 'FDV', fmt.compact(mcap))}
                {d.liquidity > 0 && row('LIQ', fmt.compact(d.liquidity))}
                {d.volume24h > 0 && row('VOL 24H', fmt.compact(d.volume24h))}
              </>
            )
          })()}
        </div>
      )}

      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Filter panel */}
        {showFilters && (
          <div style={{
            padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius)',
            marginBottom: '6px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px',
          }}>
            {/* Threshold */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>MIN VALUE</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[0, 1, 10, 100].map(v => (
                  <button key={v} onClick={() => changeThreshold(v)}
                    className={threshold === v ? 'btn-active' : 'btn-ghost'}
                    style={{ fontSize: '12px', padding: '2px 6px' }}>
                    {v === 0 ? 'ALL' : `$${v}`}
                  </button>
                ))}
              </div>
              <input
                type="number" min="0" placeholder="custom"
                value={threshold === 0 || [1, 10, 100].includes(threshold) ? '' : threshold}
                onChange={e => changeThreshold(e.target.value)}
                style={{
                  width: '60px', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font)',
                  fontSize: '13px', padding: '2px 6px', outline: 'none',
                }}
              />
            </div>

            {/* Track a token by symbol or contract address (pins it, even before you hold it) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em', flexShrink: 0 }}>TRACK</span>
              <input
                value={watchInput}
                onChange={e => setWatchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && watchInput.trim()) { addWatch(watchInput); setWatchInput('') } }}
                placeholder="symbol or address…"
                style={{
                  flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font)',
                  fontSize: '13px', padding: '2px 6px', outline: 'none',
                }}
              />
              <button onClick={() => { if (watchInput.trim()) { addWatch(watchInput); setWatchInput('') } }}
                className="btn-ghost" style={{ fontSize: '12px', padding: '2px 8px' }}>+ Track</button>
            </div>
            {watched.size > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {[...watched].map(w => (
                  <span key={w} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px',
                    color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                    borderRadius: '10px', padding: '1px 4px 1px 7px',
                  }}>
                    ★ {w.length > 18 ? w.slice(0, 6) + '…' + w.slice(-4) : w}
                    <button onClick={() => removeWatch(w)} title="Untrack"
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}>✕</button>
                  </span>
                ))}
              </div>
            )}

            {/* Hidden (spam) list */}
            {hiddenIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => setShowHidden(v => !v)}
                  className={showHidden ? 'btn-active' : 'btn-ghost'}
                  style={{ fontSize: '12px', padding: '2px 8px' }}>
                  {showHidden ? 'Hide list' : `Show hidden (${hiddenIds.size})`}
                </button>
                {showHidden && (
                  <button onClick={clearAllHidden} className="btn-ghost"
                    style={{ fontSize: '12px', padding: '2px 8px', color: 'var(--negative)' }}>
                    Clear all
                  </button>
                )}
              </div>
            )}

            {/* Blacklist */}
            {blacklisted.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button onClick={() => setShowBlacklist(v => !v)}
                  className={showBlacklist ? 'btn-active' : 'btn-ghost'}
                  style={{ fontSize: '12px', padding: '2px 8px' }}>
                  {showBlacklist ? 'Hide blacklist' : `Show blacklist (${blacklisted.size})`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Search filter + sort bar */}
        {view === 'list' && (
          <div style={{ flexShrink: 0, paddingBottom: '5px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <input
              type="text"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              placeholder="Search tokens…"
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>SORT</span>
              {Object.entries(SORT_FIELDS).map(([key, f]) => {
                const active = sort.key === key
                return (
                  <button
                    key={key}
                    onClick={() => changeSort(key)}
                    className={active ? 'btn-active' : 'btn-ghost'}
                    title={active ? 'Click to reverse order' : `Sort by ${f.label.toLowerCase()}`}
                    style={{ fontSize: '11px', padding: '1px 7px', letterSpacing: '0.05em' }}
                  >
                    {f.label}{active ? (sort.dir === 1 ? ' ↓' : ' ↑') : ''}
                  </button>
                )
              })}
              <span style={{ flex: 1 }} />
              <button
                onClick={togglePinWatched}
                className={sort.pin ? 'btn-active' : 'btn-ghost'}
                title={sort.pin ? 'Tracked ★ tokens pinned on top — click for pure sort order' : 'Pin tracked ★ tokens to the top'}
                style={{ fontSize: '11px', padding: '1px 7px', letterSpacing: '0.05em' }}
              >★ TOP</button>
            </div>
          </div>
        )}

        {/* Main content */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {visible.length === 0 && noPriceTokens.length === 0 && !showHidden && !showBlacklist ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>
              {holdings.length === 0
                ? 'No holdings — refresh a wallet first'
                : `All tokens below $${threshold} threshold — lower it in ⚙ to see more`}
            </div>
          ) : view === 'pie' ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <ResponsiveContainer width="100%" height="65%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%"
                    innerRadius="35%" outerRadius="75%" paddingAngle={2}
                    dataKey="value" labelLine={false} label={<CustomLabel />}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '4px' }}>
                {pieData.map((item, i) => {
                  const pct = total > 0 ? (item.value / total * 100).toFixed(1) : 0
                  return (
                    <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <span style={{ fontSize: '13px', color: 'var(--text)', flex: 1 }}>{item.name}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-num)' }}>{pct}%</span>
                      <span style={{ fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                        {fmt.currency(fromUSD(item.value), currency)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="alt-rows" style={{ overflow: 'auto', height: '100%' }} onScroll={endHover}>
              {filtered.map(h => <TokenRow key={h.id} h={h} />)}

              {/* Hidden (spam) list */}
              {showHidden && spamTokens.length > 0 && (
                <>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', padding: '8px 0 4px' }}>
                    — HIDDEN —
                  </div>
                  {spamTokens.map(h => <TokenRow key={h.id} h={h} isHidden />)}
                </>
              )}

              {/* Blacklisted tokens */}
              {showBlacklist && blacklistedTokens.length > 0 && (
                <>
                  <div style={{ fontSize: '11px', color: 'var(--negative)', letterSpacing: '0.1em', padding: '8px 0 4px' }}>
                    — BLACKLISTED —
                  </div>
                  {blacklistedTokens.map(h => <TokenRow key={h.id} h={h} isBlacklistedRow />)}
                </>
              )}

              {/* Dust notice */}
              {dustCount > 0 && !showFilters && (
                <div style={{ fontSize: '12px', color: 'var(--text-dim)', padding: '6px 0', textAlign: 'center' }}>
                  {dustCount} token{dustCount > 1 ? 's' : ''} below ${threshold} threshold — ⚙ to adjust
                </div>
              )}

              {/* Unpriced tokens (spam airdrops) — collapsed by default */}
              {noPriceTokens.length > 0 && (
                <div style={{ textAlign: 'center', padding: '6px 0' }}>
                  <button onClick={() => setShowNoPrice(v => !v)} className="btn-ghost" style={{ fontSize: '12px', padding: '2px 10px' }}>
                    {showNoPrice ? 'Hide' : 'Show'} {noPriceTokens.length} unpriced
                  </button>
                </div>
              )}
              {showNoPrice && noPriceTokens.length > 0 && (
                <>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', padding: '4px 0' }}>
                    — UNPRICED —
                  </div>
                  {noPriceTokens.map(h => <TokenRow key={h.id} h={h} />)}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Widget>
  )
}
