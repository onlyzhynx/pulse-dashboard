import { useRef, useState, useEffect } from 'react'
import { useTheme, THEMES } from '../../context/ThemeContext'

export default function SettingsPanel({ open, onClose }) {
  const { theme, setTheme } = useTheme()
  const panelRef = useRef(null)
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null) // { ok, imported } | { error }
  const [retagging, setRetagging] = useState(false)
  const [retagResult, setRetagResult] = useState(null)
  const [wiping, setWiping] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [snapshots, setSnapshots] = useState([])
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const loadSnapshots = () =>
    fetch('/api/portfolio/history?range=ALL')
      .then(r => r.json())
      .then(d => setSnapshots((d.snapshots || []).slice().reverse()))
      .catch(() => {})

  useEffect(() => { if (snapshotsOpen) loadSnapshots() }, [snapshotsOpen])

  const deleteSnapshot = async (id) => {
    setDeletingId(id)
    await fetch(`/api/portfolio/snapshots/${id}`, { method: 'DELETE' }).catch(() => {})
    setSnapshots(s => s.filter(x => x.id !== id))
    setDeletingId(null)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const exportData = () => {
    window.location.href = '/api/data/export'
  }

  const importData = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const res = await fetch('/api/data/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      })
      const result = await res.json()
      setImportResult(result)
    } catch (err) {
      setImportResult({ error: err.message })
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  const wipeData = async () => {
    if (!confirmWipe) { setConfirmWipe(true); return }
    setWiping(true)
    await fetch('/api/data/wipe', { method: 'DELETE' }).catch(() => {})
    setWiping(false)
    setConfirmWipe(false)
    window.location.reload()
  }

  const row = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 0', borderBottom: '1px solid var(--border)',
  }
  const label = { fontSize: '14px', color: 'var(--text)' }
  const sub = { fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 400, backdropFilter: 'blur(2px)',
      }} />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(340px, 92vw)',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border-bright)',
          zIndex: 500,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          animation: 'settings-slide-in 0.18s ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 'calc(14px + env(safe-area-inset-top))',
          paddingBottom: '14px', paddingLeft: '16px', paddingRight: '16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', letterSpacing: '0.15em' }}>
            SETTINGS
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ fontSize: '16px', padding: '2px 8px' }}>✕</button>
        </div>

        {/* Scroll body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>

          {/* ── Theme ─────────────────────────────────────── */}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.15em', padding: '16px 0 8px', textTransform: 'uppercase' }}>
            Theme
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 12px',
                  background: theme === t.id ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${theme === t.id ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  color: theme === t.id ? 'var(--accent)' : 'var(--text-muted)',
                  fontFamily: 'var(--font)', fontSize: '13px',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s',
                }}
              >
                <span style={{ letterSpacing: '0.08em' }}>{t.label}</span>
                <span style={{ fontSize: '11px', opacity: 0.6 }}>{t.desc}</span>
              </button>
            ))}
          </div>

          {/* ── Data Management ────────────────────────────── */}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.15em', padding: '16px 0 8px', textTransform: 'uppercase' }}>
            Data
          </div>

          <div style={row}>
            <div>
              <div style={label}>Export Backup</div>
              <div style={sub}>Download full JSON backup of all data</div>
            </div>
            <button onClick={exportData} className="btn-ghost" style={{ fontSize: '18px', padding: '4px 10px' }} title="Export backup">
              ⬇
            </button>
          </div>

          <div style={row}>
            <div>
              <div style={label}>Import Backup</div>
              <div style={sub}>Restore from JSON — merges, does not overwrite</div>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="btn-ghost"
              style={{ fontSize: '18px', padding: '4px 10px' }}
              title="Import backup"
            >
              {importing ? '…' : '⬆'}
            </button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importData} />
          </div>

          {/* ── Re-tag categories ── */}
          <div style={row}>
            <div>
              <div style={label}>Re-tag categories</div>
              <div style={sub}>Re-run auto-categorization on uncategorized transactions</div>
            </div>
            <button
              onClick={async () => {
                setRetagging(true); setRetagResult(null)
                try {
                  const res = await fetch('/api/bank/recategorize', { method: 'POST' })
                  setRetagResult(await res.json())
                } catch (err) {
                  setRetagResult({ error: err.message })
                } finally { setRetagging(false) }
              }}
              disabled={retagging}
              className="btn-ghost"
              style={{ fontSize: '13px', padding: '3px 10px' }}
            >{retagging ? '…' : 'Re-tag'}</button>
          </div>
          {retagResult && (
            <div style={{
              margin: '4px 0 8px',
              padding: '8px 12px', borderRadius: 'var(--radius)',
              background: retagResult.error ? 'rgba(248,113,113,0.08)' : 'var(--accent-dim)',
              border: `1px solid ${retagResult.error ? 'var(--negative)' : 'var(--accent)'}`,
              fontSize: '13px',
            }}>
              {retagResult.error
                ? <span style={{ color: 'var(--negative)' }}>✕ {retagResult.error}</span>
                : <span style={{ color: 'var(--accent)' }}>✓ {retagResult.updated} re-tagged of {retagResult.scanned} scanned</span>
              }
            </div>
          )}

          {importResult && (
            <div style={{
              margin: '8px 0',
              padding: '10px 12px',
              borderRadius: 'var(--radius)',
              background: importResult.error ? 'rgba(248,113,113,0.08)' : 'var(--accent-dim)',
              border: `1px solid ${importResult.error ? 'var(--negative)' : 'var(--accent)'}`,
              fontSize: '13px',
            }}>
              {importResult.error ? (
                <span style={{ color: 'var(--negative)' }}>✕ {importResult.error}</span>
              ) : (
                <div style={{ color: 'var(--accent)' }}>
                  ✓ Imported successfully
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {Object.entries(importResult.imported || {})
                      .map(([k, v]) => `${v} ${k}`)
                      .join(' · ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Cashout CSV Export ─────────────────────────── */}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.15em', padding: '16px 0 8px', textTransform: 'uppercase' }}>
            Export
          </div>

          <div style={row}>
            <div>
              <div style={label}>Cashouts CSV</div>
              <div style={sub}>Download your cashout history as a spreadsheet</div>
            </div>
            <button
              onClick={async () => {
                const res = await fetch('/api/cashout/history')
                const { history = [] } = await res.json()
                const headers = ['Date', 'Destination', 'Network', 'USD', 'Running Total USD', 'Notes']
                const rows = [...history]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map(e => [e.date, e.destination ?? '', e.network ?? '', e.amount_usd ?? 0, e.running_total_usd ?? '', (e.notes ?? '').replace(/,/g, ' ')])
                const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
                const a = document.createElement('a')
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
                a.download = `cashouts-${new Date().toISOString().slice(0, 10)}.csv`
                a.click()
              }}
              className="btn-ghost"
              style={{ fontSize: '18px', padding: '4px 10px' }}
              title="Download cashouts CSV"
            >⬇</button>
          </div>

          {/* ── Portfolio History ──────────────────────────── */}
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.15em', padding: '16px 0 8px', textTransform: 'uppercase' }}>
            Portfolio History
          </div>

          <div style={row}>
            <div>
              <div style={label}>Manual Snapshot</div>
              <div style={sub}>Force a snapshot of current portfolio value</div>
            </div>
            <button
              onClick={async () => {
                const res = await fetch('/api/portfolio/snapshot-now', { method: 'POST' }).catch(() => null)
                if (!res) return
                const d = await res.json().catch(() => ({}))
                if (snapshotsOpen) loadSnapshots()
                alert(d.ok ? `Snapshot saved: $${Math.round(d.value).toLocaleString()}` : (d.reason || 'Failed'))
              }}
              className="btn-ghost"
              style={{ fontSize: '13px', padding: '3px 10px' }}
            >Now</button>
          </div>

          <div style={row}>
            <div>
              <div style={label}>Compact history</div>
              <div style={sub}>Keep one point per day (the day's highest value)</div>
            </div>
            <button
              onClick={async () => {
                const d = await fetch('/api/portfolio/compact', { method: 'POST' })
                  .then(r => r.json()).catch(() => ({ error: 'failed' }))
                if (snapshotsOpen) loadSnapshots()
                alert(d.error ? `Failed: ${d.error}` : `Done — kept ${d.kept} daily points, removed ${d.removed}.`)
              }}
              className="btn-ghost"
              style={{ fontSize: '13px', padding: '3px 10px' }}
            >Compact</button>
          </div>

          <div style={row}>
            <div>
              <div style={label}>Snapshot entries</div>
              <div style={sub}>View and delete bugged data points</div>
            </div>
            <button
              onClick={() => setSnapshotsOpen(v => !v)}
              className={snapshotsOpen ? 'btn-active' : 'btn-ghost'}
              style={{ fontSize: '13px', padding: '3px 10px' }}
            >
              {snapshotsOpen ? 'Close' : 'Manage'}
            </button>
          </div>

          {snapshotsOpen && (
            <div style={{ marginBottom: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              {snapshots.length === 0 ? (
                <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>No snapshots</div>
              ) : (
                <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                  {snapshots.map(s => (
                    <div key={s.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 10px', borderBottom: '1px solid var(--border)',
                      fontSize: '13px',
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-num)', fontSize: '12px' }}>
                        {s.captured_at.replace('T', ' ').slice(0, 16)}
                      </span>
                      <span style={{ color: 'var(--text)', marginLeft: '8px', flex: 1, textAlign: 'right', marginRight: '10px' }}>
                        ${Math.round(s.value).toLocaleString()}
                      </span>
                      <button
                        onClick={() => deleteSnapshot(s.id)}
                        disabled={deletingId === s.id}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--negative)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
                      >
                        {deletingId === s.id ? '…' : '✕'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Danger Zone ────────────────────────────────── */}
          <div style={{ fontSize: '11px', color: 'var(--negative)', letterSpacing: '0.15em', padding: '24px 0 8px', textTransform: 'uppercase' }}>
            Danger
          </div>

          <div style={{ ...row, borderColor: 'rgba(248,113,113,0.2)' }}>
            <div>
              <div style={{ ...label, color: 'var(--negative)' }}>Wipe All Data</div>
              <div style={sub}>Permanently delete all wallets, transactions, history</div>
            </div>
            <button
              onClick={wipeData}
              disabled={wiping}
              style={{
                background: confirmWipe ? 'var(--negative)' : 'transparent',
                border: '1px solid var(--negative)',
                borderRadius: 'var(--radius)',
                color: confirmWipe ? '#000' : 'var(--negative)',
                fontFamily: 'var(--font)', fontSize: '12px',
                padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.08em',
                transition: 'all 0.15s',
              }}
            >
              {wiping ? '…' : confirmWipe ? 'CONFIRM' : '🗑'}
            </button>
          </div>
          {confirmWipe && (
            <div style={{ fontSize: '12px', color: 'var(--negative)', marginBottom: '8px' }}>
              Click CONFIRM again to permanently delete everything, or close panel to cancel.
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes settings-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
