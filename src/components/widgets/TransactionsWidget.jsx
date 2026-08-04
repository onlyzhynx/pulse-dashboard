import { useState, useEffect } from 'react'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'
import { CATEGORY_COLORS } from '../../utils/colors'

const PRESET_CATEGORIES = [
  'Food', 'Transport', 'Housing', 'Subscriptions', 'Travel',
  'Health', 'Shopping', 'Tech', 'Gaming', 'Hobbies', 'Income', 'Bill', 'Investment', 'Transfer', 'Other',
]

function CategoryPill({ label }) {
  if (!label) return null
  const color = CATEGORY_COLORS[label] ?? '#94a3b8'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: '20px',
      fontSize: '11px', fontWeight: '700', letterSpacing: '0.05em',
      background: color + '22', color, border: `1px solid ${color}44`,
      whiteSpace: 'nowrap', textTransform: 'uppercase', flexShrink: 0,
    }}>{label}</span>
  )
}

function getMonthOptions(thisMonth) {
  const [ty, tm] = thisMonth.split('-').map(Number)
  const opts = []
  for (let i = 0; i <= 12; i++) {
    const d = new Date(ty, tm - 1 - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = i === 0 ? 'This Month' : i === 1 ? 'Last Month'
      : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    opts.push({ value: val, label })
  }
  return opts
}

const INCOME_CATEGORIES = ['Income', 'Salary']

const emptyAdd = () => ({
  date: new Date().toISOString().slice(0, 10),
  description: '', merchant: '', amount: '', category: 'Food',
})

function getClearedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('pulse-cleared-txs') || '[]')) } catch { return new Set() }
}
function toggleCleared(id) {
  const s = getClearedSet()
  if (s.has(id)) s.delete(id); else s.add(id)
  localStorage.setItem('pulse-cleared-txs', JSON.stringify([...s]))
  return s.has(id)
}

// ── Edit Modal ────────────────────────────────────────────────
function EditModal({ transaction, accounts, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    description: transaction.description || '',
    merchant: transaction.notes || '',
    amount: Math.abs(transaction.amount ?? '').toString(),
    date: transaction.date || new Date().toISOString().slice(0, 10),
    category: transaction.category || 'Other',
  })
  const [cleared, setCleared] = useState(() => getClearedSet().has(transaction.id))

  const handleSave = () => {
    const raw = Math.abs(parseFloat(form.amount) || 0)
    const signedAmount = INCOME_CATEGORIES.includes(form.category) ? raw : -raw
    onSave({ ...form, amount: signedAmount })
  }

  const inputStyle = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '15px',
    padding: '8px 10px', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '24px', width: '480px', maxWidth: '90vw',
        display: 'flex', flexDirection: 'column', gap: '16px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)', letterSpacing: '0.04em' }}>
            Edit Transaction
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            fontSize: '20px', cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Name */}
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.1em' }}>NAME</div>
          <input style={inputStyle} value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
        </div>

        {/* Merchant + Date */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.1em' }}>MERCHANT / SOURCE</div>
            <input style={inputStyle} value={form.merchant} placeholder="e.g. Steam, Amazon"
              onChange={e => setForm(p => ({ ...p, merchant: e.target.value }))} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.1em' }}>DATE</div>
            <input type="date" style={inputStyle} value={form.date}
              onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
        </div>

        {/* Amount */}
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.1em' }}>AMOUNT</div>
          <input type="number" style={{ ...inputStyle, borderColor: INCOME_CATEGORIES.includes(form.category) ? 'var(--positive)' : 'var(--negative)' }}
            value={form.amount} placeholder="Enter amount"
            onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
          <div style={{ fontSize: '12px', color: INCOME_CATEGORIES.includes(form.category) ? 'var(--positive)' : 'var(--negative)', marginTop: '4px' }}>
            {INCOME_CATEGORIES.includes(form.category) ? '+ will be saved as income' : '− will be saved as expense'}
          </div>
        </div>

        {/* Category */}
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.1em' }}>CATEGORY</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {PRESET_CATEGORIES.map(c => {
              const color = CATEGORY_COLORS[c] ?? '#94a3b8'
              const isActive = form.category === c
              return (
                <button key={c} onClick={() => setForm(p => ({ ...p, category: c }))}
                  style={{
                    background: isActive ? color + '33' : 'transparent',
                    color: isActive ? color : 'var(--text-muted)',
                    border: `1px solid ${isActive ? color + '88' : 'var(--border)'}`,
                    borderRadius: '20px', fontFamily: 'var(--font)',
                    fontSize: '12px', padding: '3px 10px', cursor: 'pointer',
                    letterSpacing: '0.04em', transition: 'all 0.1s',
                  }}>{c}</button>
              )
            })}
          </div>
        </div>

        {/* Cleared toggle */}
        <button
          onClick={() => { const now = toggleCleared(transaction.id); setCleared(now) }}
          style={{
            background: cleared ? 'rgba(74,222,128,0.1)' : 'transparent',
            border: `1px solid ${cleared ? 'var(--positive)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', color: cleared ? 'var(--positive)' : 'var(--text-muted)',
            fontFamily: 'var(--font)', fontSize: '13px', padding: '6px 14px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
            letterSpacing: '0.06em', transition: 'all 0.15s',
          }}
        >
          {cleared ? '✓ Cleared' : '○ Mark as Cleared'}
        </button>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
          <button onClick={onDelete} style={{
            background: 'transparent', border: 'none', color: 'var(--negative)',
            fontFamily: 'var(--font)', fontSize: '14px', cursor: 'pointer', padding: '6px 0',
            letterSpacing: '0.04em',
          }}>Delete</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)', borderRadius: 'var(--radius)',
              fontFamily: 'var(--font)', fontSize: '14px', padding: '8px 16px', cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={handleSave} className="btn-primary"
              style={{ padding: '8px 24px', fontSize: '14px', fontWeight: 700 }}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Widget ───────────────────────────────────────────────
// `wide` = dedicated-tab mode: uses the full width and adds an insights
// sidebar (spend by category / top merchants) fed by the current filters.
export default function TransactionsWidget({ title = 'All Transactions', wide = false }) {
  const { currency, fromUSD } = useCurrency()
  const thisMonth = new Date().toISOString().slice(0, 7)
  // 'Recent' (value '') shows the latest activity across all months so the
  // feed is never empty just because the current month has no transactions.
  const monthOptions = [{ value: '', label: 'Recent' }, ...getMonthOptions(thisMonth)]

  const [month, setMonth]               = useState('')
  const [filter, setFilter]             = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch]             = useState('')
  const [viewMode, setViewMode]         = useState('list') // 'list' | 'table'
  const [sortCol, setSortCol]           = useState('date')
  const [sortDir, setSortDir]           = useState('desc')
  const [transactions, setTransactions] = useState([])
  const [accounts, setAccounts]         = useState([])
  const [loading, setLoading]           = useState(false)
  const [editTx, setEditTx]             = useState(null)
  const [hoveredId, setHoveredId]       = useState(null)
  const [showAdd, setShowAdd]           = useState(false)
  const [addForm, setAddForm]           = useState(emptyAdd)
  const [selectedAccount, setSelectedAccount] = useState('')
  const [clearedSet, setClearedSet]     = useState(() => getClearedSet())

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '500' })
    if (month) params.set('month', month)
    if (selectedAccount) params.set('account_id', selectedAccount)
    if (!selectedAccount) params.set('include_cashouts', 'true')
    fetch(`/api/bank/transactions?${params}`)
      .then(r => r.ok ? r.json() : { transactions: [] })
      .then(d => { setTransactions(d.transactions || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    fetch('/api/bank/accounts')
      .then(r => r.ok ? r.json() : { accounts: [] })
      .then(d => setAccounts(d.accounts || []))
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [month, selectedAccount])

  // ── Filtering ──
  const visible = transactions.filter(t => {
    if (filter === 'income'  && t.amount <= 0) return false
    if (filter === 'expense' && t.amount >= 0) return false
    if (categoryFilter && t.category !== categoryFilter) return false
    if (search && !`${t.description} ${t.category} ${t.notes}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // ── Sorting (for table view) ──
  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sorted = [...visible].sort((a, b) => {
    let av, bv
    if (sortCol === 'date')     { av = a.date || ''; bv = b.date || '' }
    else if (sortCol === 'amount') { av = a.amount; bv = b.amount }
    else if (sortCol === 'description') { av = (a.description || '').toLowerCase(); bv = (b.description || '').toLowerCase() }
    else if (sortCol === 'merchant')    { av = (a.notes || '').toLowerCase(); bv = (b.notes || '').toLowerCase() }
    else if (sortCol === 'category')    { av = (a.category || '').toLowerCase(); bv = (b.category || '').toLowerCase() }
    else { av = a.date || ''; bv = b.date || '' }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  // List view: group by date (always date-desc)
  const listSorted = [...visible].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const groups = listSorted.reduce((acc, t) => {
    const d = t.date || 'Unknown'
    ;(acc[d] = acc[d] || []).push(t)
    return acc
  }, {})
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  const totalIn  = visible.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
  const totalOut = visible.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
  const fmtAmt   = (usd) => fmt.currency(fromUSD(usd), currency)

  const allCategories = [...new Set(transactions.map(t => t.category).filter(Boolean))].sort()

  // ── Sidebar insights (wide mode) — reflect the current filters ──
  const spendRows = visible.filter(t => t.amount < 0)
  const catSpend = spendRows.reduce((m, t) => {
    const c = t.category || 'Other'
    m[c] = (m[c] || 0) + Math.abs(t.amount)
    return m
  }, {})
  const catList = Object.entries(catSpend).sort((a, b) => b[1] - a[1]).slice(0, 8)
  const catMax = catList[0]?.[1] || 1
  const merchSpend = spendRows.reduce((m, t) => {
    const k = t.notes || t.destination || t.description || '—'
    m[k] = (m[k] || 0) + Math.abs(t.amount)
    return m
  }, {})
  const merchList = Object.entries(merchSpend).sort((a, b) => b[1] - a[1]).slice(0, 6)

  const saveEdit = async (form) => {
    const amount = typeof form.amount === 'number' ? form.amount : parseFloat(form.amount)
    await fetch(`/api/bank/transactions/${editTx.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: form.description,
        notes: form.merchant,
        amount,
        date: form.date,
        category: form.category,
        type: amount < 0 ? 'expense' : 'income',
      }),
    }).catch(() => {})
    setEditTx(null)
    load()
  }

  const deleteT = async (id) => {
    if (!confirm('Delete this transaction?')) return
    await fetch(`/api/bank/transactions/${id}`, { method: 'DELETE' }).catch(() => {})
    setEditTx(null)
    load()
  }

  const saveAdd = async () => {
    const acctId = addForm.account_id || selectedAccount || accounts[0]?.id
    if (!acctId || !addForm.description || !addForm.amount) return
    const raw = Math.abs(parseFloat(addForm.amount))
    const amount = INCOME_CATEGORIES.includes(addForm.category) ? raw : -raw
    await fetch('/api/bank/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: acctId,
        date: addForm.date,
        description: addForm.description,
        notes: addForm.merchant,
        amount,
        category: addForm.category,
        type: amount < 0 ? 'expense' : 'income',
      }),
    }).catch(() => {})
    setAddForm(emptyAdd())
    setShowAdd(false)
    load()
  }

  const inputStyle = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '13px', padding: '5px 8px',
    outline: 'none',
  }

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span style={{ opacity: 0.3, fontSize: '11px' }}> ↕</span>
    return <span style={{ fontSize: '11px', color: 'var(--accent)' }}> {sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <Widget
      title={title}
      subtitle={`${fmtAmt(totalIn)} in · ${fmtAmt(totalOut)} out`}
      actions={
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {accounts.length > 1 && (
            <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
              style={{ ...inputStyle, fontSize: '12px', padding: '2px 6px' }}>
              <option value="">All</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      }
    >
      {/* ── Edit Modal ── */}
      {editTx && (
        <EditModal
          transaction={editTx}
          accounts={accounts}
          onSave={saveEdit}
          onDelete={() => deleteT(editTx.id)}
          onClose={() => { setEditTx(null); setClearedSet(getClearedSet()) }}
        />
      )}

      <div style={{
        height: '100%',
        display: wide ? 'grid' : 'block',
        gridTemplateColumns: wide ? 'minmax(0, 1fr) 300px' : undefined,
        gap: wide ? '28px' : undefined,
      }}>
      <div style={{
        height: '100%', width: '100%', minWidth: 0,
        maxWidth: wide ? 'none' : '1200px',
        margin: wide ? 0 : '0 auto',
        display: 'flex', flexDirection: 'column', gap: '8px',
      }}>

        {/* ── Controls bar ── */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {/* Month */}
          <select value={month} onChange={e => setMonth(e.target.value)}
            style={{ ...inputStyle, fontSize: '12px', padding: '4px 8px', flexShrink: 0 }}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {/* Type filter */}
          <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
            {[['all', 'All'], ['income', 'In'], ['expense', 'Out']].map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                className={filter === v ? 'btn-active' : 'btn-ghost'}
                style={{ fontSize: '12px', padding: '3px 8px' }}>{l}</button>
            ))}
          </div>

          {/* Category filter */}
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            style={{ ...inputStyle, fontSize: '12px', padding: '4px 8px', flexShrink: 0 }}>
            <option value="">All categories</option>
            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Search */}
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…" style={{ ...inputStyle, flex: 1, minWidth: '80px' }} />

          {/* View toggle */}
          <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
            <button onClick={() => setViewMode('list')} className={viewMode === 'list' ? 'btn-active' : 'btn-ghost'}
              style={{ fontSize: '13px', padding: '3px 8px' }} title="List">☰</button>
            <button onClick={() => setViewMode('table')} className={viewMode === 'table' ? 'btn-active' : 'btn-ghost'}
              style={{ fontSize: '13px', padding: '3px 8px' }} title="Table">▦</button>
          </div>

          {/* + New */}
          {accounts.length > 0 && (
            <button onClick={() => { setShowAdd(v => !v); setEditTx(null) }}
              className={showAdd ? 'btn-active' : 'btn-ghost'}
              style={{ fontSize: '13px', fontWeight: 700, padding: '3px 10px', flexShrink: 0, letterSpacing: '0.06em' }}>
              {showAdd ? '✕' : '+ NEW'}
            </button>
          )}
        </div>

        {/* ── Quick add form ── */}
        {showAdd && (
          <div style={{
            flexShrink: 0, padding: '11px 13px', borderRadius: '12px',
            background: 'var(--accent-dim)',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--accent)', letterSpacing: '0.1em' }}>— QUICK ADD —</div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: '6px' }}>
              <input type="date" style={inputStyle} value={addForm.date}
                onChange={e => setAddForm(p => ({ ...p, date: e.target.value }))} />
              <input style={inputStyle} placeholder="Description"
                value={addForm.description}
                onChange={e => setAddForm(p => ({ ...p, description: e.target.value }))} />
              <input style={inputStyle} placeholder="Merchant / Source"
                value={addForm.merchant}
                onChange={e => setAddForm(p => ({ ...p, merchant: e.target.value }))} />
            </div>
            {accounts.length > 1 && (
              <select style={inputStyle} value={addForm.account_id || selectedAccount || accounts[0]?.id || ''}
                onChange={e => setAddForm(p => ({ ...p, account_id: e.target.value }))}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '6px' }}>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {PRESET_CATEGORIES.map(c => (
                  <button key={c} onClick={() => setAddForm(p => ({ ...p, category: c }))}
                    style={{
                      background: addForm.category === c ? 'var(--accent)' : 'transparent',
                      color: addForm.category === c ? '#000' : 'var(--text-muted)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                      fontFamily: 'var(--font)', fontSize: '11px', padding: '2px 7px', cursor: 'pointer',
                    }}>{c}</button>
                ))}
              </div>
              <input type="number" style={inputStyle} placeholder="Amount (−exp)"
                value={addForm.amount}
                onChange={e => setAddForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={saveAdd} disabled={!addForm.description || !addForm.amount}
                className="btn-primary" style={{ flex: 1, fontSize: '13px' }}>ADD</button>
              <button onClick={() => setShowAdd(false)} className="btn-ghost"
                style={{ padding: '5px 12px', fontSize: '13px' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Summary bar ── */}
        <div style={{
          display: 'flex', flexShrink: 0,
          borderBottom: '1px solid var(--border)', paddingBottom: '8px', gap: '24px',
        }}>
          {[
            { label: 'IN',  value: '+' + fmtAmt(totalIn),  color: 'var(--positive)' },
            { label: 'OUT', value: '−' + fmtAmt(totalOut), color: 'var(--negative)' },
            { label: 'NET', value: fmtAmt(totalIn - totalOut),
              color: totalIn - totalOut >= 0 ? 'var(--positive)' : 'var(--negative)' },
            { label: 'TXS', value: String(visible.length), color: 'var(--text-muted)', noBlur: true },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.12em' }}>{item.label}</span>
              <span className={item.noBlur ? '' : 'blur-value'} style={{
                fontSize: '15px', fontWeight: 600,
                fontFamily: 'var(--font-num)', color: item.color,
              }}>{item.value}</span>
            </div>
          ))}
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '24px 0', textAlign: 'center' }}>Loading…</div>
          ) : visible.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '24px 0', textAlign: 'center' }}>No transactions</div>
          ) : viewMode === 'table' ? (

            /* ════ TABLE VIEW ════ */
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {[
                    { col: 'date',        label: 'Date',     w: '88px'  },
                    { col: 'description', label: 'Name',     w: 'auto'  },
                    { col: 'merchant',    label: 'Merchant', w: '120px' },
                    { col: 'amount',      label: 'Amount',   w: '100px' },
                    { col: 'category',    label: 'Category', w: '110px' },
                  ].map(({ col, label, w }) => (
                    <th key={col} onClick={() => toggleSort(col)}
                      style={{
                        padding: '6px 8px', textAlign: col === 'amount' ? 'right' : 'left',
                        color: sortCol === col ? 'var(--text)' : 'var(--text-muted)',
                        fontSize: '11px', letterSpacing: '0.1em', fontWeight: 600,
                        cursor: 'pointer', userSelect: 'none', width: w, whiteSpace: 'nowrap',
                      }}>
                      {label}<SortIcon col={col} />
                    </th>
                  ))}
                  <th style={{ width: '32px' }} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => (
                  <tr key={t.id}
                    onMouseEnter={() => setHoveredId(t.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: hoveredId === t.id ? 'var(--bg-hover)' : 'transparent',
                      transition: 'background 0.1s',
                      cursor: 'pointer',
                    }}
                    onClick={() => !t.destination && setEditTx(t)}
                  >
                    <td style={{ padding: '8px 8px', color: 'var(--text-dim)', whiteSpace: 'nowrap', fontSize: '13px' }}>
                      {t.date ? new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '8px 8px', color: 'var(--text)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: CATEGORY_COLORS[t.category] ?? '#94a3b8', flexShrink: 0 }} />
                        {t.description || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '8px 8px', color: 'var(--text-muted)', fontSize: '13px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.notes || t.destination || '—'}
                    </td>
                    <td className="blur-value" style={{
                      padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-num)', fontWeight: 600,
                      color: t.amount >= 0 ? 'var(--positive)' : 'var(--negative)',
                    }}>
                      {t.amount >= 0 ? '+' : '−'}{fmtAmt(Math.abs(t.amount))}
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      {t.category && <CategoryPill label={t.category} />}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                      {hoveredId === t.id && !t.destination && (
                        <button onClick={e => { e.stopPropagation(); setEditTx(t) }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', padding: '0 4px' }}>
                          ✎
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          ) : (

            /* ════ LIST VIEW ════ */
            dates.map(date => (
              <div key={date}>
                <div style={{
                  fontSize: '12px', color: 'var(--text-dim)', letterSpacing: '0.12em',
                  padding: '8px 2px 3px', textTransform: 'uppercase',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>{new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span style={{ opacity: 0.5 }}>{groups[date].length} tx</span>
                </div>

                {groups[date].map(t => (
                  <div
                    key={t.id}
                    onMouseEnter={() => setHoveredId(t.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => !t.destination && setEditTx(t)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '6px 4px',
                      borderBottom: '1px solid var(--border)',
                      cursor: t.destination ? 'default' : 'pointer',
                      background: hoveredId === t.id ? 'var(--bg-hover)' : 'transparent',
                      borderRadius: hoveredId === t.id ? '4px' : 0,
                      transition: 'background 0.1s',
                    }}
                  >
                    {/* Color dot / cleared check */}
                    {clearedSet.has(t.id) ? (
                      <span style={{ fontSize: '12px', color: 'var(--positive)', flexShrink: 0, width: 6, lineHeight: 1 }}>✓</span>
                    ) : (
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: CATEGORY_COLORS[t.category] ?? '#94a3b8',
                      }} />
                    )}

                    {/* Description + merchant/meta */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description || t.category || '—'}
                      </div>
                      {(t.notes || t.destination || (accounts.length > 1 && accounts.find(a => a.id === t.account_id))) && (
                        <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.notes || t.destination
                            ? `${t.notes || t.destination}`
                            : accounts.find(a => a.id === t.account_id)?.name}
                        </div>
                      )}
                    </div>

                    {/* Category pill */}
                    {t.category && <CategoryPill label={t.category} />}

                    {/* Amount */}
                    <div className="blur-value" style={{
                      fontSize: '14px', fontWeight: 600,
                      fontFamily: 'var(--font-num)',
                      color: t.amount >= 0 ? 'var(--positive)' : 'var(--negative)',
                      flexShrink: 0,
                    }}>
                      {t.amount >= 0 ? '+' : '−'}{fmtAmt(Math.abs(t.amount))}
                    </div>

                    {/* Edit button on hover */}
                    {hoveredId === t.id && !t.destination && (
                      <button onClick={e => { e.stopPropagation(); setEditTx(t) }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}>
                        ✎
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Insights sidebar (wide mode) ── */}
      {wide && (
        <div style={{
          borderLeft: '1px solid var(--border)', paddingLeft: '24px',
          minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: '22px',
        }}>
          {/* Spend by category — click a row to filter the list */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: '10px' }}>
              SPEND BY CATEGORY
            </div>
            {catList.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--text-dim)' }}>—</div>
            ) : catList.map(([cat, amt]) => {
              const color = CATEGORY_COLORS[cat] ?? '#94a3b8'
              const active = categoryFilter === cat
              return (
                <div key={cat}
                  onClick={() => setCategoryFilter(active ? '' : cat)}
                  title={active ? 'Clear filter' : `Filter: ${cat}`}
                  style={{ cursor: 'pointer', padding: '4px 0', opacity: categoryFilter && !active ? 0.45 : 1, transition: 'opacity 0.12s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', marginBottom: '3px' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: active ? 'var(--accent)' : 'var(--text)', fontWeight: active ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
                    <span className="blur-value" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-num)', fontSize: '12px', flexShrink: 0 }}>{fmtAmt(amt)}</span>
                  </div>
                  <div style={{ height: '3px', background: 'var(--border)', borderRadius: '2px' }}>
                    <div style={{ height: '100%', width: `${(amt / catMax) * 100}%`, background: color, borderRadius: '2px', transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Top merchants */}
          {merchList.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: '8px' }}>
                TOP MERCHANTS
              </div>
              {merchList.map(([name, amt]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: '13px' }}>
                  <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span className="blur-value" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-num)', fontSize: '12px', flexShrink: 0 }}>{fmtAmt(amt)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: 'auto' }}>
            Reflects current filters
          </div>
        </div>
      )}
      </div>
    </Widget>
  )
}
