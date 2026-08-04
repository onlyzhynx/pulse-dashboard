import { useState, useEffect, useCallback } from 'react'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

const TX_CATEGORIES = ['Income', 'Salary', 'Trading', 'Cashout', 'Expense', 'Bill', 'Transfer', 'Other']

const today = () => new Date().toISOString().slice(0, 10)

const TYPE_ICON = { checking: '◈', savings: '◉', credit: '▣', investment: '◆', crypto: '◎' }

export default function BankAccountsWidget() {
  const { currency, fromUSD, rates } = useCurrency()
  const [accounts, setAccounts]   = useState([])
  const [wallets, setWallets]     = useState([])
  const [txs, setTxs]             = useState({})
  const [expanded, setExpanded]   = useState(null)
  const [showAdd, setShowAdd]     = useState(false)
  const [hoveredId, setHoveredId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deletedToast, setDeletedToast] = useState(null) // { id, name, tx_count }
  const [editBalId, setEditBalId] = useState(null)
  const [balInput, setBalInput]   = useState('')

  const [newAcc, setNewAcc] = useState({ name: '', bank: '', type: 'checking', currency: 'USD', starting_balance: '' })
  const [txForm, setTxForm] = useState({ date: today(), description: '', amount: '', category: 'Income' })
  const [addingTx, setAddingTx] = useState(false)

  const inputStyle = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '14px',
    padding: '6px 8px', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  const loadAccounts = useCallback(() =>
    fetch('/api/bank/accounts')
      .then(r => r.json())
      .then(d => setAccounts(d.accounts || []))
      .catch(() => {}), [])

  const loadWallets = useCallback(() =>
    fetch('/api/wallets/snapshot')
      .then(r => r.ok ? r.json() : { wallets: [] })
      .then(d => setWallets((d.wallets || []).filter(w => w.enabled !== 0 && (w.total_usd || 0) > 0)))
      .catch(() => {}), [])

  const loadTxs = useCallback((accountId) =>
    fetch(`/api/bank/transactions?account_id=${accountId}&limit=20`)
      .then(r => r.json())
      .then(d => setTxs(prev => ({ ...prev, [accountId]: d.transactions || [] })))
      .catch(() => {}), [])

  useEffect(() => { loadAccounts(); loadWallets() }, [loadAccounts, loadWallets])

  const toggleExpand = (id) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setTxForm({ date: today(), description: '', amount: '', category: 'Income' })
    loadTxs(id)
  }

  const addAccount = async () => {
    if (!newAcc.name) return
    await fetch('/api/bank/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newAcc, balance: parseFloat(newAcc.starting_balance) || 0 }),
    }).catch(() => {})
    setNewAcc({ name: '', bank: '', type: 'checking', currency: 'USD', starting_balance: '' })
    setShowAdd(false)
    loadAccounts()
  }

  const handleDeleteAccount = async (e, id) => {
    e.stopPropagation()
    // First click arms the confirm; second click within 3s performs the delete.
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      setTimeout(() => setConfirmDeleteId(prev => prev === id ? null : prev), 3000)
      return
    }
    setConfirmDeleteId(null)
    try {
      const r = await fetch(`/api/bank/accounts/${id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (expanded === id) setExpanded(null)
      // Deletion is reversible — server kept a snapshot. Offer Undo for 8s.
      setDeletedToast({ id, name: d.name || 'Account', tx_count: d.tx_count || 0 })
      setTimeout(() => setDeletedToast(prev => (prev?.id === id ? null : prev)), 8000)
      loadAccounts()
    } catch { /* ignore */ }
  }

  const undoDelete = async () => {
    if (!deletedToast) return
    const { id } = deletedToast
    setDeletedToast(null)
    await fetch(`/api/bank/accounts/${id}/restore`, { method: 'POST' }).catch(() => {})
    loadAccounts()
  }

  const addTransaction = async (accountId) => {
    if (!txForm.description || !txForm.amount) return
    setAddingTx(true)
    const raw = parseFloat(txForm.amount)
    const isExpense = ['Expense', 'Bill'].includes(txForm.category)
    const amount = isExpense ? -Math.abs(raw) : Math.abs(raw)
    await fetch('/api/bank/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, date: txForm.date, description: txForm.description, amount, category: txForm.category }),
    }).catch(() => {})
    setTxForm({ date: today(), description: '', amount: '', category: txForm.category })
    setAddingTx(false)
    loadAccounts()
    loadTxs(accountId)
  }

  const deleteTx = async (txId, accountId) => {
    await fetch(`/api/bank/transactions/${txId}`, { method: 'DELETE' }).catch(() => {})
    loadAccounts()
    loadTxs(accountId)
  }

  const saveBalance = async (id) => {
    const val = parseFloat(balInput)
    setEditBalId(null)
    if (isNaN(val)) return
    await fetch(`/api/bank/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: val }),
    }).catch(() => {})
    loadAccounts()
  }

  const usdEur = rates?.EUR ?? 0.92
  const bankUSD = accounts.reduce((s, a) => {
    const bal = a.balance || 0  // the balance you set — consistent with Net Worth
    if (a.currency === 'USD') return s + bal
    if (a.currency === 'EUR') return s + bal / usdEur
    return s
  }, 0)
  const cryptoUSD = wallets.reduce((s, w) => s + (w.total_usd || 0), 0)
  const totalUSD = bankUSD + cryptoUSD

  const subtitle = fmt.currency(fromUSD(totalUSD), currency)

  return (
    <Widget
      title="Balances"
      subtitle={subtitle}
      actions={
        <button
          onClick={() => { setShowAdd(v => !v); setExpanded(null) }}
          className={showAdd ? 'btn-active' : 'btn-ghost'}
          style={{ fontSize: '15px', fontWeight: '600', padding: '0 8px', lineHeight: '22px' }}
        >{showAdd ? '✕' : '+'}</button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* ── Undo-delete toast ── */}
        {deletedToast && (
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
            padding: '8px 11px', marginBottom: '8px',
            background: 'var(--negative-dim)',
            boxShadow: 'inset 2px 0 0 var(--negative)', borderRadius: 'var(--radius)', fontSize: '13px',
          }}>
            <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Deleted <strong>{deletedToast.name}</strong>{deletedToast.tx_count ? ` · ${deletedToast.tx_count} txns` : ''}
            </span>
            <button onClick={undoDelete} className="btn-ghost"
              style={{ flexShrink: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', padding: '2px 8px', color: 'var(--accent)' }}>
              UNDO
            </button>
          </div>
        )}

        {/* ── Add account form ── */}
        {showAdd && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px', padding: '11px', background: 'var(--accent-dim)', borderRadius: 'var(--radius)', marginBottom: '8px' }}>
            <input style={inputStyle} placeholder="Account name (e.g. Main Checking)"
              value={newAcc.name} onChange={e => setNewAcc(p => ({ ...p, name: e.target.value }))} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <select style={inputStyle} value={newAcc.type} onChange={e => setNewAcc(p => ({ ...p, type: e.target.value }))}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit Card</option>
                <option value="investment">Investment</option>
              </select>
              <select style={inputStyle} value={newAcc.currency} onChange={e => setNewAcc(p => ({ ...p, currency: e.target.value }))}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <input style={inputStyle} type="number" placeholder="Starting balance"
              value={newAcc.starting_balance} onChange={e => setNewAcc(p => ({ ...p, starting_balance: e.target.value }))} />
            <button onClick={addAccount} disabled={!newAcc.name} className="btn-primary">ADD ACCOUNT</button>
          </div>
        )}

        {/* ── Account list ── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {accounts.length === 0 && wallets.length === 0 && !showAdd && (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>No accounts — click + to add one</div>
          )}

          {accounts.map((acc, idx) => {
            const isExpanded = expanded === acc.id
            const isHovered  = hoveredId === acc.id
            const balance    = acc.balance ?? 0
            const txTotal    = acc.tx_total ?? 0
            const accountTxs = txs[acc.id] || []
            const isLast     = idx === accounts.length - 1

            return (
              <div key={acc.id}>
                {/* ── Account row ── */}
                <div
                  onClick={() => toggleExpand(acc.id)}
                  onMouseEnter={() => setHoveredId(acc.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '9px 4px',
                    borderBottom: (!isLast || isExpanded) ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                    background: isHovered ? 'var(--bg-hover)' : 'transparent',
                    transition: 'background 0.1s',
                    borderRadius: isHovered ? '4px' : 0,
                  }}
                >
                  {/* Type icon */}
                  <span style={{ fontSize: '13px', color: 'var(--text-dim)', flexShrink: 0, width: '14px', textAlign: 'center' }}>
                    {TYPE_ICON[acc.type] || '◈'}
                  </span>

                  {/* Name + meta — tx sum lives in the expanded panel; the all-time
                      figure was misleading next to a manually-set balance */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', color: 'var(--text)', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {acc.name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '1px' }}>
                      {acc.bank}{acc.type ? ` · ${acc.type}` : ''}
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="blur-value" style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '15px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                      {fmt.currency(balance, acc.currency)}
                    </div>
                  </div>

                  {/* Actions — visible on hover */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s', width: isHovered ? 'auto' : '0', overflow: 'hidden' }}>
                    <button
                      onClick={e => handleDeleteAccount(e, acc.id)}
                      title={confirmDeleteId === acc.id
                        ? `Delete "${acc.name}"${acc.tx_count ? ` and its ${acc.tx_count} transactions` : ''}? Click to confirm (undoable).`
                        : 'Delete account'}
                      style={{
                        background: confirmDeleteId === acc.id ? 'var(--negative)' : 'transparent',
                        border: 'none', borderRadius: 'var(--radius)',
                        color: confirmDeleteId === acc.id ? '#000' : 'var(--text-dim)',
                        fontSize: confirmDeleteId === acc.id ? '8px' : '11px', fontWeight: confirmDeleteId === acc.id ? 700 : 400,
                        cursor: 'pointer', padding: confirmDeleteId === acc.id ? '2px 5px' : '0 4px',
                        lineHeight: 1, letterSpacing: '0.04em', transition: 'all 0.15s', whiteSpace: 'nowrap',
                      }}
                    >{confirmDeleteId === acc.id
                        ? (acc.tx_count ? `DELETE ${acc.tx_count} TX?` : 'DELETE?')
                        : '✕'}</button>
                  </div>

                  {/* Expand chevron */}
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)', flexShrink: 0, transition: 'transform 0.15s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>▼</span>
                </div>

                {/* ── Expanded panel ── */}
                {isExpanded && (
                  <div style={{ background: 'var(--bg-card)', borderBottom: isLast ? 'none' : '1px solid var(--border)', padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>

                    {/* Editable balance */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-dim)', paddingBottom: '6px', borderBottom: '1px solid var(--border)' }}>
                      <span>Balance</span>
                      {editBalId === acc.id ? (
                        <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <input
                            autoFocus type="number" value={balInput}
                            onChange={e => setBalInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveBalance(acc.id); if (e.key === 'Escape') setEditBalId(null) }}
                            style={{ ...inputStyle, width: '110px', padding: '3px 6px', fontSize: '13px' }}
                          />
                          <button onClick={() => saveBalance(acc.id)} className="btn-primary" style={{ fontSize: '11px', padding: '3px 7px' }}>✓</button>
                        </span>
                      ) : (
                        <span
                          onClick={() => { setEditBalId(acc.id); setBalInput(String(balance)) }}
                          title="Click to edit balance"
                          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text)' }}
                        >
                          <span className="blur-value">{fmt.currency(balance, acc.currency)}</span>
                          <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>✎</span>
                        </span>
                      )}
                    </div>
                    {txTotal !== 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', paddingBottom: '4px' }}>
                        <span>Net this period (analysis only)</span>
                        <span className="blur-value" style={{ color: txTotal >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                          {txTotal >= 0 ? '+' : ''}{fmt.currency(txTotal, acc.currency)}
                        </span>
                      </div>
                    )}

                    {/* Transactions */}
                    {accountTxs.length === 0 ? (
                      <div style={{ fontSize: '12px', color: 'var(--text-dim)', padding: '2px 0' }}>No transactions yet</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', maxHeight: '130px', overflowY: 'auto' }}>
                        {accountTxs.map(tx => (
                          <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ color: 'var(--text-dim)', flexShrink: 0, width: '66px', fontSize: '12px' }}>{tx.date?.slice(0, 10)}</span>
                            <span style={{ flex: 1, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tx.description}
                            </span>
                            {tx.category && (
                              <span style={{ fontSize: '11px', color: 'var(--text-dim)', flexShrink: 0, letterSpacing: '0.04em' }}>{tx.category}</span>
                            )}
                            <span className="blur-value" style={{
                              color: tx.amount >= 0 ? 'var(--positive)' : 'var(--negative)',
                              fontFamily: 'var(--font-num)', flexShrink: 0, width: '68px', textAlign: 'right',
                            }}>
                              {tx.amount >= 0 ? '+' : ''}{fmt.number(tx.amount, 0)}
                            </span>
                            <button
                              onClick={() => deleteTx(tx.id, acc.id)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: '13px', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0, opacity: 0.5 }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--negative)'; e.currentTarget.style.opacity = '1' }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.opacity = '0.5' }}
                              title="Delete transaction"
                            >✕</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add transaction form */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>ADD TRANSACTION</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '5px' }}>
                        <input style={inputStyle} type="date" value={txForm.date}
                          onChange={e => setTxForm(p => ({ ...p, date: e.target.value }))} />
                        <input style={inputStyle} placeholder="Description"
                          value={txForm.description} onChange={e => setTxForm(p => ({ ...p, description: e.target.value }))} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                        <select style={inputStyle} value={txForm.category}
                          onChange={e => setTxForm(p => ({ ...p, category: e.target.value }))}>
                          {TX_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input style={inputStyle} type="number" placeholder="Amount (positive)"
                          value={txForm.amount} onChange={e => setTxForm(p => ({ ...p, amount: e.target.value }))} />
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Expense/Bill → saved as negative</div>
                      <button
                        onClick={() => addTransaction(acc.id)}
                        disabled={addingTx || !txForm.description || !txForm.amount}
                        className="btn-primary"
                        style={{ fontSize: '12px', padding: '5px' }}
                      >{addingTx ? '…' : 'ADD'}</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Crypto wallet rows (side wallets collapsed into one row) ── */}
          {wallets.length > 0 && (() => {
            const mainW = wallets.filter(w => !w.side)
            const sideW = wallets.filter(w => w.side)
            const sideTotal = sideW.reduce((s, w) => s + (w.total_usd || 0), 0)
            const rows = [
              ...mainW.map(w => ({
                key: w.id || w.address,
                label: w.label || w.address?.slice(0, 8) || w.network,
                sub: w.network,
                value: w.total_usd || 0,
              })),
              ...(sideW.length > 0 ? [{
                key: '__side__',
                label: 'Side wallets',
                sub: `${sideW.length} wallet${sideW.length !== 1 ? 's' : ''}`,
                value: sideTotal,
              }] : []),
            ]
            return (
              <>
                {accounts.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', padding: '8px 4px 4px' }}>CRYPTO</div>
                )}
                {rows.map((r, idx) => (
                  <div
                    key={r.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '9px 4px',
                      borderBottom: idx !== rows.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: '13px', color: 'var(--text-dim)', flexShrink: 0, width: '14px', textAlign: 'center' }}>{r.key === '__side__' ? '⊟' : '◎'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.label}
                      </div>
                      {r.sub && (
                        <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '1px' }}>{r.sub}</div>
                      )}
                    </div>
                    <div className="blur-value" style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '15px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                        {fmt.currency(fromUSD(r.value), currency)}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )
          })()}
        </div>
      </div>
    </Widget>
  )
}
