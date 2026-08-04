import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

import { DEST_COLORS } from '../../utils/colors'

const NETWORKS = ['Multi', 'Solana', 'EVM', 'Bitcoin']
const DESTINATIONS = ['Coinbase', 'Kraken', 'Binance', 'Bank', 'Wire', 'Other']

function DestPill({ label }) {
  const color = DEST_COLORS[label] ?? '#94a3b8'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '20px',
      fontSize: '11px', fontWeight: '700', letterSpacing: '0.06em',
      background: color + '22', color, border: `1px solid ${color}44`,
      whiteSpace: 'nowrap', textTransform: 'uppercase',
    }}>{label}</span>
  )
}

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  amount_usd: '',
  destination: 'Coinbase',
  network: 'Multi',
  notes: '',
  bank_account_id: '',
  bank_credit_amount: '',
  credit_to_bank: false,
}

export default function CashFlowWidget() {
  const { currency, fromUSD } = useCurrency()
  const [history, setHistory] = useState([])
  const [view, setView] = useState('list')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState(null)
  const [bankAccounts, setBankAccounts] = useState([])
  const [undoState, setUndoState] = useState(null) // { entry, timerId }
  const undoRef = useRef(null)

  const load = () =>
    fetch('/api/cashout/history')
      .then(r => r.json())
      .then(d => setHistory(d.history || []))
      .catch(() => {})

  const loadBankAccounts = () =>
    fetch('/api/bank/accounts')
      .then(r => r.ok ? r.json() : { accounts: [] })
      .then(d => {
        const accs = d.accounts || []
        setBankAccounts(accs)
        if (accs.length && !form.bank_account_id) {
          setForm(p => ({ ...p, bank_account_id: accs[0].id }))
        }
      })
      .catch(() => {})

  useEffect(() => { load(); loadBankAccounts() }, [])

  // ── Save (add or edit) ───────────────────────────────────
  const save = async () => {
    if (!form.date || !form.amount_usd) return
    setSaving(true)
    const payload = {
      date: form.date,
      amount_usd: parseFloat(form.amount_usd) || 0,
      destination: form.destination,
      network: form.network,
      notes: form.notes,
    }
    if (editId) {
      await fetch(`/api/cashout/history/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
      setEditId(null)
    } else {
      // Include bank credit fields only on new entries
      if (form.credit_to_bank && form.bank_account_id && form.bank_credit_amount) {
        payload.bank_account_id = form.bank_account_id
        payload.bank_credit_amount = parseFloat(form.bank_credit_amount) || 0
      }
      await fetch('/api/cashout/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    }
    setForm(emptyForm)
    setShowAdd(false)
    setSaving(false)
    load()
  }

  const startEdit = (entry) => {
    setForm({
      date: entry.date,
      amount_usd: entry.amount_usd ?? '',
      destination: entry.destination ?? DESTINATIONS[0],
      network: entry.network ?? 'Multi',
      notes: entry.notes ?? '',
    })
    setEditId(entry.id)
    setShowAdd(true)
  }

  const cancelForm = () => {
    setForm(emptyForm)
    setEditId(null)
    setShowAdd(false)
  }

  const deleteEntry = (entry) => {
    // Commit any currently pending undo first
    if (undoRef.current) {
      clearTimeout(undoRef.current.timerId)
      fetch(`/api/cashout/history/${undoRef.current.entry.id}`, { method: 'DELETE' }).catch(() => {})
    }
    // Optimistically remove from list
    setHistory(h => h.filter(x => x.id !== entry.id))
    // Schedule real delete after 3.5s
    const timerId = setTimeout(() => {
      fetch(`/api/cashout/history/${entry.id}`, { method: 'DELETE' }).catch(() => {})
      setUndoState(null)
      undoRef.current = null
    }, 3500)
    const state = { entry, timerId }
    undoRef.current = state
    setUndoState(state)
  }

  const undoDelete = () => {
    if (!undoRef.current) return
    clearTimeout(undoRef.current.timerId)
    setHistory(h => [...h, undoRef.current.entry])
    setUndoState(null)
    undoRef.current = null
  }

  // ── CSV export ───────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['Date', 'Destination', 'Network', 'Amount USD', 'Running Total USD', 'Notes']
    const rows = [...history].sort((a, b) => a.date.localeCompare(b.date)).map(e => [
      e.date,
      e.destination ?? '',
      e.network ?? '',
      e.amount_usd ?? 0,
      e.running_total_usd ?? '',
      (e.notes ?? '').replace(/,/g, ' '),
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `cashout-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  // ── Computed ─────────────────────────────────────────────
  const totalUSD = history.reduce((s, e) => s + (e.amount_usd || 0), 0)

  const byMonth = history.reduce((acc, e) => {
    const m = e.date.slice(0, 7)
    acc[m] = (acc[m] || 0) + (e.amount_usd || 0)
    return acc
  }, {})

  const thisMonthKey = new Date().toISOString().slice(0, 7)
  const thisMonth = byMonth[thisMonthKey] || 0

  const chartData = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-18)
    .map(([month, total]) => ({
      month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      key: month,
      total,
    }))

  const money = (usd) => fmt.currency(fromUSD(usd), currency)

  const selectedAccount = bankAccounts.find(a => a.id === form.bank_account_id)

  // ── Styles ───────────────────────────────────────────────
  const inputStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontFamily: 'var(--font)',
    fontSize: '14px',
    padding: '5px 8px',
    outline: 'none',
    width: '100%',
  }

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 'var(--radius)', fontFamily: 'var(--font)', fontSize: '14px', color: 'var(--text)' }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{payload[0].payload.month}</div>
        <div>{money(payload[0].value)}</div>
      </div>
    )
  }

  return (
    <>
    <Widget
      title="Cashouts"
      subtitle={`All time: ${money(totalUSD)}`}
      actions={
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => setView('list')} className={view === 'list' ? 'btn-active' : 'btn-ghost'} title="List view" style={{ fontSize: '15px', padding: '2px 7px' }}>☰</button>
          <button onClick={() => setView('chart')} className={view === 'chart' ? 'btn-active' : 'btn-ghost'} title="Chart view" style={{ fontSize: '15px', padding: '2px 7px' }}>▦</button>
          <button onClick={exportCSV} className="btn-ghost" title="Export CSV" style={{ fontSize: '15px', padding: '2px 7px' }}>⬇</button>
          <button
            onClick={() => showAdd ? cancelForm() : setShowAdd(true)}
            style={{
              background: showAdd ? 'var(--accent)' : 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              color: showAdd ? '#000' : 'var(--text-muted)',
              fontFamily: 'var(--font)',
              fontSize: '16px',
              fontWeight: '600',
              padding: '0px 8px',
              cursor: 'pointer',
            }}
          >
            {showAdd ? '✕' : '+'}
          </button>
        </div>
      }
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* Summary row */}
        <div style={{ display: 'flex', gap: '20px', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>This month</div>
            <div className="blur-value" style={{ fontSize: '17px', color: 'var(--text)' }}>{money(thisMonth)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>All time</div>
            <div className="blur-value" style={{ fontSize: '17px', color: 'var(--text)' }}>{money(totalUSD)}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Cashouts</div>
            <div style={{ fontSize: '17px', color: 'var(--text)' }}>{history.length}</div>
          </div>
        </div>

        {/* Add / Edit form */}
        {showAdd && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '11px', background: 'var(--accent-dim)', borderRadius: 'var(--radius)', flexShrink: 0 }}>
            <div style={{ fontSize: '13px', color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: '2px' }}>
              {editId ? '— EDIT ENTRY —' : '— NEW CASHOUT —'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>DATE</div>
                <input type="date" style={inputStyle} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>NETWORK</div>
                <select style={inputStyle} value={form.network} onChange={e => setForm(p => ({ ...p, network: e.target.value }))}>
                  {NETWORKS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>AMOUNT USD *</div>
                <input type="number" style={inputStyle} placeholder="e.g. 5000" value={form.amount_usd} onChange={e => setForm(p => ({ ...p, amount_usd: e.target.value }))} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>DESTINATION</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {DESTINATIONS.map(d => (
                  <button
                    key={d}
                    onClick={() => setForm(p => ({ ...p, destination: d }))}
                    style={{
                      background: form.destination === d ? 'var(--accent)' : 'var(--bg)',
                      color: form.destination === d ? '#000' : 'var(--text-muted)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontFamily: 'var(--font)',
                      fontSize: '12px',
                      padding: '3px 8px',
                      cursor: 'pointer',
                    }}
                  >{d}</button>
                ))}
                {!DESTINATIONS.includes(form.destination) && (
                  <span style={{ fontSize: '13px', color: 'var(--accent)', alignSelf: 'center' }}>{form.destination}</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>NOTES</div>
              <input style={inputStyle} placeholder="e.g. sold SOL, wired to checking" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>

            {/* Bank account credit — only show for new entries */}
            {!editId && bankAccounts.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={form.credit_to_bank}
                    onChange={e => setForm(p => ({
                      ...p,
                      credit_to_bank: e.target.checked,
                      bank_credit_amount: e.target.checked ? (p.amount_usd || '') : '',
                    }))}
                    style={{ accentColor: 'var(--accent)', width: '14px', height: '14px' }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                    CREDIT TO BANK ACCOUNT
                  </span>
                </label>
                {form.credit_to_bank && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>ACCOUNT</div>
                      <select
                        style={inputStyle}
                        value={form.bank_account_id}
                        onChange={e => setForm(p => ({ ...p, bank_account_id: e.target.value }))}
                      >
                        {bankAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>
                        CREDIT AMOUNT ({selectedAccount?.currency || 'USD'})
                      </div>
                      <input
                        type="number"
                        style={inputStyle}
                        placeholder={form.amount_usd || 'e.g. 5000'}
                        value={form.bank_credit_amount}
                        onChange={e => setForm(p => ({ ...p, bank_credit_amount: e.target.value }))}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={save}
                disabled={saving || !form.date || !form.amount_usd}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  fontFamily: 'var(--font)',
                  fontSize: '13px',
                  fontWeight: '700',
                  padding: '7px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.1em',
                }}
              >
                {saving ? '...' : editId ? 'SAVE CHANGES' : 'ADD ENTRY'}
              </button>
              <button onClick={cancelForm} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontFamily: 'var(--font)', fontSize: '13px', padding: '7px 12px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Main content */}
        <div style={{ overflow: 'hidden' }}>
          {view === 'chart' ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font)' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="total" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.key === thisMonthKey
                        ? 'var(--accent)'
                        : i >= chartData.length - 3
                          ? 'var(--chart-muted)'
                          : 'rgba(255,255,255,0.15)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ overflow: 'auto', height: '100%', paddingRight: '2px' }}>
              {[...history].reverse().map((entry, idx) => {
                const isLatest = idx === 0
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '9px 11px', marginBottom: '5px',
                      background: isLatest ? 'var(--accent-dim)' : 'var(--surface)',
                      borderRadius: '10px',
                    }}
                  >
                    {/* Left: date + pill + notes */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <DestPill label={entry.destination ?? 'Other'} />
                        {entry.network && entry.network !== 'Multi' && (
                          <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>{entry.network}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{entry.date}</span>
                        {entry.notes && (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.notes}</span>
                        )}
                      </div>
                    </div>
                    {/* Right: amount + actions */}
                    <div style={{ flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                      <div className="blur-value" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                        {entry.amount_usd ? money(entry.amount_usd) : '—'}
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                      <button
                        onClick={() => startEdit(entry)}
                        title="Edit"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
                      >✎</button>
                      <button
                        onClick={() => deleteEntry(entry)}
                        title="Delete"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '14px', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--negative)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
                      >✕</button>
                    </div>
                  </div>
                )
              })}
              {history.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', padding: '6px 4px 2px', borderTop: '1px solid var(--border)', marginTop: '2px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>RUNNING TOTAL</span>
                  <span className="blur-value" style={{ fontSize: '14px', color: 'var(--accent)', fontFamily: 'var(--font-num)' }}>
                    {money(history[history.length - 1]?.running_total_usd || totalUSD)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Widget>

    {undoState && createPortal(
      <div style={{
        position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
        borderRadius: 'var(--radius)', padding: '10px 16px',
        display: 'flex', alignItems: 'center', gap: '12px',
        zIndex: 1000, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        fontFamily: 'var(--font)', fontSize: '14px', color: 'var(--text)',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ color: 'var(--text-muted)' }}>Entry deleted</span>
        <button onClick={undoDelete} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius)',
          color: '#000', fontFamily: 'var(--font)', fontSize: '13px', fontWeight: 700,
          padding: '3px 12px', cursor: 'pointer', letterSpacing: '0.08em',
        }}>UNDO</button>
      </div>,
      document.body
    )}
    </>
  )
}
