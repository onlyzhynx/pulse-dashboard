import { useState, useEffect, useRef, useCallback } from 'react'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'
import WalletDetailModal from './WalletDetailModal'

const POLL_INTERVAL = 30 * 60 * 1000 // 30 minutes (display refresh; snapshots are 12h)

function relativeTime(dateStr) {
  if (!dateStr) return null
  // SQLite datetime('now') is UTC without timezone marker — append Z
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z')
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  return `${diffH}h ago`
}

function fmtCountdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${m}:${String(ss).padStart(2, '0')}`
}

export default function WalletsWidget() {
  const { currency, fromUSD } = useCurrency()
  const [wallets, setWallets] = useState([])
  const [refreshing, setRefreshing] = useState(null) // wallet id or 'all'
  const [selectedWallet, setSelectedWallet] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ label: '', address: '', network: 'Solana' })
  const [adding, setAdding] = useState(false)
  const [countdown, setCountdown] = useState(POLL_INTERVAL)
  const nextTickRef = useRef(Date.now() + POLL_INTERVAL)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('pulse-side-open') === '1')

  const toggleSideOpen = () => {
    setSideOpen(v => { localStorage.setItem('pulse-side-open', v ? '0' : '1'); return !v })
  }

  // Move a wallet into / out of the Side wallets folder (still tracked + counted)
  const toggleSide = async (e, w) => {
    e.stopPropagation()
    await fetch(`/api/wallets/${w.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: w.side ? 0 : 1 }),
    }).catch(() => {})
    load()
  }

  const load = useCallback(() =>
    fetch('/api/wallets/snapshot')
      .then(r => r.json())
      .then(d => setWallets(d.wallets || []))
      .catch(() => {}), [])

  const refreshAll = useCallback(async (silent = false) => {
    if (!silent) setRefreshing('all')
    // Manual click writes a net-worth point now; the silent poll lets the 12h throttle decide.
    await fetch(`/api/wallets/refresh-all${silent ? '' : '?manual=1'}`, { method: 'POST' }).catch(() => {})
    await load()
    if (!silent) setRefreshing(null)
    nextTickRef.current = Date.now() + POLL_INTERVAL
  }, [load])

  // Initial load
  useEffect(() => { load() }, [load])

  // Auto-refresh poll + countdown ticker
  useEffect(() => {
    nextTickRef.current = Date.now() + POLL_INTERVAL

    const poll = setInterval(() => {
      refreshAll(true)
      nextTickRef.current = Date.now() + POLL_INTERVAL
    }, POLL_INTERVAL)

    const ticker = setInterval(() => {
      setCountdown(Math.max(0, nextTickRef.current - Date.now()))
    }, 5000) // update every 5s is plenty

    return () => { clearInterval(poll); clearInterval(ticker) }
  }, [refreshAll])

  const refreshOne = async (id) => {
    setRefreshing(id)
    await fetch(`/api/wallets/${id}/refresh`, { method: 'POST' }).catch(() => {})
    await load()
    setRefreshing(null)
  }

  const addWallet = async () => {
    if (!form.address || !form.network) return
    setAdding(true)
    await fetch('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).catch(() => {})
    setForm({ label: '', address: '', network: 'Solana' })
    setShowAdd(false)
    setAdding(false)
    load()
  }

  const deleteWallet = async (id) => {
    await fetch(`/api/wallets/${id}`, { method: 'DELETE' }).catch(() => {})
    setConfirmDeleteId(null)
    load()
  }

  const handleDeleteClick = (e, id) => {
    e.stopPropagation()
    if (confirmDeleteId === id) {
      deleteWallet(id)
    } else {
      setConfirmDeleteId(id)
      setTimeout(() => setConfirmDeleteId(prev => prev === id ? null : prev), 3000)
    }
  }

  const onDragStart = (e, id) => { e.dataTransfer.effectAllowed = 'move'; setDragId(id) }
  const onDragOver  = (e, id) => { e.preventDefault(); setDragOverId(id) }
  const onDrop      = async (e, targetId) => {
    e.preventDefault()
    setDragId(null); setDragOverId(null)
    if (!dragId || dragId === targetId) return
    const next = [...wallets]
    const from = next.findIndex(w => w.id === dragId)
    const to   = next.findIndex(w => w.id === targetId)
    next.splice(to, 0, next.splice(from, 1)[0])
    setWallets(next)
    await fetch('/api/wallets/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next.map(w => w.id) }),
    }).catch(() => {})
  }
  const onDragEnd = () => { setDragId(null); setDragOverId(null) }

  const total = wallets.reduce((s, w) => s + (w.total_usd || 0), 0)
  const isRefreshingAll = refreshing === 'all'

  const mainWallets = wallets.filter(w => !w.side)
  const sideWallets = wallets.filter(w => w.side)
  const sideTotal = sideWallets.reduce((s, w) => s + (w.total_usd || 0), 0)

  const inputStyle = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '14px',
    padding: '6px 8px', outline: 'none', width: '100%',
  }

  const renderWalletRow = (w) => (
    <div
      key={w.id}
      draggable
      onDragStart={e => onDragStart(e, w.id)}
      onDragOver={e => onDragOver(e, w.id)}
      onDrop={e => onDrop(e, w.id)}
      onDragEnd={onDragEnd}
      onClick={() => setSelectedWallet(w)}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '9px 11px', background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        boxShadow: dragOverId === w.id && dragId !== w.id ? 'inset 0 0 0 1px var(--accent)' : 'none',
        cursor: 'pointer', transition: 'background 0.12s',
        opacity: dragId === w.id ? 0.4 : 1,
      }}
      onMouseEnter={e => { if (dragOverId !== w.id) e.currentTarget.style.background = 'var(--surface-hover)' }}
      onMouseLeave={e => { if (dragOverId !== w.id) e.currentTarget.style.background = 'var(--surface)' }}
    >
      {/* Drag handle */}
      <div
        title="Drag to reorder"
        style={{ color: 'var(--text-dim)', fontSize: '14px', marginRight: '6px', cursor: 'grab', flexShrink: 0, lineHeight: 1 }}
        onMouseDown={e => e.stopPropagation()}
      >⠿</div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '14px', color: 'var(--text)', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {w.label || w.address.slice(0, 10) + '…'}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '1px', display: 'flex', gap: '6px' }}>
          <span>{w.network} · {w.address.slice(0, 6)}…{w.address.slice(-4)}</span>
          {w.last_refreshed && (
            <span style={{ color: 'var(--text-dim)' }}>{relativeTime(w.last_refreshed)}</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <div className="blur-value" style={{ fontSize: '15px', color: 'var(--text)' }}>
          {fmt.currency(fromUSD(w.total_usd || 0), currency)}
        </div>
        <button
          onClick={e => toggleSide(e, w)}
          title={w.side ? 'Move back to main wallets' : 'Move to side wallets folder'}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', padding: 0, lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
        >{w.side ? '⤴' : '⤵'}</button>
        <button
          onClick={e => { e.stopPropagation(); refreshOne(w.id) }}
          disabled={!!refreshing}
          title="Refresh this wallet"
          style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '16px', cursor: 'pointer', padding: 0, lineHeight: 1, opacity: refreshing ? 0.5 : 1 }}
        >
          {refreshing === w.id ? '…' : '↻'}
        </button>
        <button
          onClick={e => handleDeleteClick(e, w.id)}
          title={confirmDeleteId === w.id ? 'Click again to confirm' : 'Remove wallet'}
          style={{
            background: confirmDeleteId === w.id ? 'var(--negative)' : 'transparent',
            border: 'none', borderRadius: 'var(--radius)',
            color: confirmDeleteId === w.id ? '#000' : 'var(--text-dim)',
            fontSize: confirmDeleteId === w.id ? '9px' : '13px',
            cursor: 'pointer', padding: confirmDeleteId === w.id ? '1px 4px' : '0',
            lineHeight: 1, letterSpacing: '0.04em', transition: 'all 0.15s',
          }}
        >{confirmDeleteId === w.id ? 'SURE?' : '✕'}</button>
      </div>
    </div>
  )

  return (
    <>
    <Widget
      title="Wallets"
      subtitle={fmt.currency(fromUSD(total), currency)}
      actions={
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
            {isRefreshingAll ? '↻ refreshing…' : `↻ ${fmtCountdown(countdown)}`}
          </span>
          <button
            onClick={() => refreshAll(false)}
            disabled={!!refreshing}
            title="Refresh all wallets now"
            className="btn-ghost"
            style={{ fontSize: '14px', padding: '1px 7px', opacity: refreshing ? 0.5 : 1 }}
          >
            {isRefreshingAll ? '…' : '↻'}
          </button>
          <button
            onClick={() => setShowAdd(v => !v)}
            className={showAdd ? 'btn-active' : 'btn-ghost'}
            style={{ fontSize: '15px', fontWeight: '600', padding: '0 8px', lineHeight: '22px' }}
          >
            {showAdd ? '✕' : '+'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

        {/* Add form */}
        {showAdd && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '11px', background: 'var(--accent-dim)', borderRadius: 'var(--radius)', marginBottom: '4px' }}>
            <input
              style={inputStyle}
              placeholder="Label (e.g. Trading)"
              value={form.label}
              onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
            />
            <input
              style={inputStyle}
              placeholder="Wallet address"
              value={form.address}
              onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
            />
            <select style={inputStyle} value={form.network} onChange={e => setForm(p => ({ ...p, network: e.target.value }))}>
              <option value="Solana">Solana</option>
              <option value="EVM">EVM (Ethereum / Base / BNB / Robinhood)</option>
              <option value="Robinhood">Robinhood Chain only</option>
              <option value="Hyperliquid">Hyperliquid (perps)</option>
            </select>
            <button onClick={addWallet} disabled={adding || !form.address} className="btn-primary">
              {adding ? '…' : 'ADD WALLET'}
            </button>
          </div>
        )}

        {/* Wallet list */}
        {wallets.length === 0 && !showAdd ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>No wallets — click + to add one</div>
        ) : (
          <>
            {mainWallets.map(w => renderWalletRow(w))}

            {/* ── Side wallets folder ── */}
            {sideWallets.length > 0 && (
              <>
                <div
                  onClick={toggleSideOpen}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '9px 11px', marginTop: '4px',
                    background: 'var(--surface)', borderRadius: 'var(--radius)',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                >
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', transition: 'transform 0.15s', transform: sideOpen ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)', flex: 1 }}>
                    Side wallets <span style={{ color: 'var(--text-dim)' }}>· {sideWallets.length}</span>
                  </span>
                  <span className="blur-value" style={{ fontSize: '14px', color: 'var(--text-muted)', fontFamily: 'var(--font-num)' }}>
                    {fmt.currency(fromUSD(sideTotal), currency)}
                  </span>
                </div>
                {sideOpen && sideWallets.map(w => renderWalletRow(w))}
              </>
            )}
          </>
        )}
      </div>
    </Widget>

    {selectedWallet && (
      <WalletDetailModal
        wallet={wallets.find(w => w.id === selectedWallet.id) ?? selectedWallet}
        refreshing={refreshing === selectedWallet.id ? true : false}
        onRefresh={() => refreshOne(selectedWallet.id)}
        onClose={() => setSelectedWallet(null)}
      />
    )}
  </>
  )
}
