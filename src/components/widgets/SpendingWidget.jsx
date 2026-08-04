import { useState, useEffect } from 'react'
import { PieChart, Pie, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

import { CATEGORY_COLORS } from '../../utils/colors'

const PRESET_CATEGORIES = ['Food', 'Transport', 'Housing', 'Subscriptions', 'Travel', 'Health', 'Shopping', 'Other']

function CategoryPill({ label }) {
  const color = CATEGORY_COLORS[label] ?? '#94a3b8'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: '20px',
      fontSize: '11px', fontWeight: '700', letterSpacing: '0.05em',
      background: color + '22', color, border: `1px solid ${color}44`,
      whiteSpace: 'nowrap', textTransform: 'uppercase',
      flexShrink: 0,
    }}>{label}</span>
  )
}

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: '',
  category: 'Food',
  description: '',
  customCategory: '',
}

export default function SpendingWidget() {
  const { currency, fromUSD } = useCurrency()
  const [transactions, setTransactions] = useState([])
  const [view, setView] = useState('list')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [selectedAccount, setSelectedAccount] = useState('')

  const load = () =>
    fetch(`/api/bank/transactions${selectedAccount ? `?account_id=${selectedAccount}` : ''}`)
      .then(r => r.ok ? r.json() : { transactions: [] })
      .then(d => setTransactions(d.transactions || []))
      .catch(() => {})

  const loadAccounts = () =>
    fetch('/api/bank/accounts')
      .then(r => r.ok ? r.json() : { accounts: [] })
      .then(d => { setAccounts(d.accounts || []); if (d.accounts?.length && !selectedAccount) setSelectedAccount(d.accounts[0].id) })
      .catch(() => {})

  useEffect(() => { loadAccounts() }, [])
  useEffect(() => { load() }, [selectedAccount])

  const effectiveCategory = form.category === '__custom__' ? form.customCategory : form.category

  const save = async () => {
    if (!form.date || !form.amount) return
    setSaving(true)
    await fetch('/api/bank/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: selectedAccount,
        date: form.date,
        amount: -Math.abs(parseFloat(form.amount)),
        description: form.description || effectiveCategory,
        category: effectiveCategory,
        type: 'expense',
      }),
    }).catch(() => {})
    setForm(emptyForm)
    setShowAdd(false)
    setSaving(false)
    load()
  }

  // ── Computed ──
  const fmtAmt = (usd) => fmt.currency(fromUSD(usd), currency)
  // Exclude card bill payments ('skip') and money moved to investments/transfers —
  // none of those are real spending.
  const NON_SPEND = ['skip', 'Investment', 'Transfer']
  const expenses = transactions.filter(t => t.amount < 0 && !NON_SPEND.includes(t.category || ''))
  const thisMonth = new Date().toISOString().slice(0, 7)
  const monthExpenses = expenses.filter(t => t.date?.startsWith(thisMonth))
  const monthTotal = monthExpenses.reduce((s, t) => s + Math.abs(t.amount), 0)

  const byCategory = expenses.reduce((acc, t) => {
    const cat = t.category || 'Other'
    acc[cat] = (acc[cat] || 0) + Math.abs(t.amount)
    return acc
  }, {})

  const chartData = Object.entries(byCategory)
    .sort(([,a],[,b]) => b - a)
    .slice(0, 8)
    .map(([cat, total]) => ({ cat, total, short: cat.slice(0, 4) }))

  const monthDisplay = fmt.currency(fromUSD(monthTotal), currency)

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
    const val = payload[0].value
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 'var(--radius)', fontFamily: 'var(--font)', fontSize: '14px', color: 'var(--text)' }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{payload[0].payload.cat}</div>
        <div>{fmtAmt(val)}</div>
      </div>
    )
  }

  return (
    <Widget
      title="Spending"
      subtitle={`This month: ${monthDisplay}`}
      actions={
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => setView('list')} className={view === 'list' ? 'btn-active' : 'btn-ghost'} title="List view" style={{ fontSize: '15px', padding: '2px 7px' }}>☰</button>
          <button onClick={() => setView('chart')} className={view === 'chart' ? 'btn-active' : 'btn-ghost'} title="Bar chart" style={{ fontSize: '15px', padding: '2px 7px' }}>▦</button>
          <button onClick={() => setView('pie')} className={view === 'pie' ? 'btn-active' : 'btn-ghost'} title="Pie chart" style={{ fontSize: '15px', padding: '2px 7px' }}>◔</button>
          <button
            onClick={() => setShowAdd(v => !v)}
            className={showAdd ? 'btn-active' : 'btn-ghost'}
            style={{ fontSize: '15px', fontWeight: '600', padding: '0 8px', lineHeight: '22px' }}
          >{showAdd ? '✕' : '+'}</button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

        {/* Account selector */}
        {accounts.length > 1 && (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            {accounts.map(a => (
              <button key={a.id} onClick={() => setSelectedAccount(a.id)}
                className={selectedAccount === a.id ? 'btn-active' : 'btn-ghost'}
                style={{ fontSize: '12px', padding: '2px 8px' }}>{a.name}</button>
            ))}
          </div>
        )}

        {/* Add form */}
        {showAdd && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '11px', background: 'var(--accent-dim)', borderRadius: 'var(--radius)', flexShrink: 0 }}>
            <div style={{ fontSize: '13px', color: 'var(--accent)', letterSpacing: '0.1em' }}>— NEW EXPENSE —</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>DATE</div>
                <input type="date" style={inputStyle} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>AMOUNT *</div>
                <input type="number" style={inputStyle} placeholder="e.g. 45.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>CATEGORY</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {PRESET_CATEGORIES.map(cat => (
                  <button key={cat} onClick={() => setForm(p => ({ ...p, category: cat }))}
                    style={{
                      background: form.category === cat ? 'var(--accent)' : 'var(--bg)',
                      color: form.category === cat ? '#000' : 'var(--text-muted)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                      fontFamily: 'var(--font)', fontSize: '12px', padding: '3px 8px', cursor: 'pointer',
                    }}>{cat}</button>
                ))}
                <button onClick={() => setForm(p => ({ ...p, category: '__custom__' }))}
                  style={{
                    background: form.category === '__custom__' ? 'var(--accent)' : 'var(--bg)',
                    color: form.category === '__custom__' ? '#000' : 'var(--text-muted)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    fontFamily: 'var(--font)', fontSize: '12px', padding: '3px 8px', cursor: 'pointer',
                  }}>+ Custom</button>
              </div>
              {form.category === '__custom__' && (
                <input style={{ ...inputStyle, marginTop: '6px' }} placeholder="Category name"
                  value={form.customCategory} onChange={e => setForm(p => ({ ...p, customCategory: e.target.value }))} />
              )}
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '3px' }}>DESCRIPTION</div>
              <input style={inputStyle} placeholder="e.g. Mercado Livre" value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={save} disabled={saving || !form.amount}
                className="btn-primary" style={{ flex: 1 }}>
                {saving ? '...' : 'ADD EXPENSE'}
              </button>
              <button onClick={() => { setForm(emptyForm); setShowAdd(false) }}
                className="btn-ghost" style={{ padding: '7px 12px' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ overflow: 'hidden' }}>
          {view === 'chart' ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="short" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font)' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="total" radius={[2, 2, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={CATEGORY_COLORS[entry.cat] ?? 'var(--chart-muted)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : view === 'pie' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {chartData.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>No data</div>
              ) : (
                <>
                  <div style={{ position: 'relative', height: '180px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={chartData.map(d => ({ name: d.cat, value: d.total }))}
                          cx="50%" cy="50%"
                          innerRadius="46%" outerRadius="75%"
                          dataKey="value" paddingAngle={2}
                          startAngle={90} endAngle={-270}
                        >
                          {chartData.map((entry, i) => (
                            <Cell key={i} fill={CATEGORY_COLORS[entry.cat] ?? '#94a3b8'} strokeWidth={0} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex',
                      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none',
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>TOTAL</div>
                      <div className="blur-value" style={{ fontSize: '14px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                        {monthDisplay}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px' }}>
                    {chartData.map(entry => (
                      <div key={entry.cat} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: CATEGORY_COLORS[entry.cat] ?? '#94a3b8' }} />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{entry.cat}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ overflow: 'auto', height: '100%', paddingRight: '2px' }}>
              {expenses.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>
                  No expenses yet — click + to add one
                </div>
              ) : (() => {
                // Group by date
                const sorted = [...expenses].sort((a, b) => b.date?.localeCompare(a.date ?? '') ?? 0)
                const groups = sorted.reduce((acc, t) => {
                  const d = t.date || 'Unknown'
                  ;(acc[d] = acc[d] || []).push(t)
                  return acc
                }, {})
                const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a))
                return (
                  <>
                    {dates.map(date => (
                      <div key={date}>
                        {/* Date group header */}
                        <div style={{
                          fontSize: '12px', color: 'var(--text-dim)', letterSpacing: '0.1em',
                          padding: '8px 2px 4px', textTransform: 'uppercase',
                        }}>
                          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                        {/* Transaction rows */}
                        {groups[date].map(t => {
                          const dotColor = CATEGORY_COLORS[t.category] ?? '#94a3b8'
                          return (
                            <div key={t.id} style={{
                              display: 'flex', alignItems: 'center',
                              padding: '7px 2px',
                              borderBottom: '1px solid var(--border)',
                              gap: '8px',
                            }}>
                              {/* Color dot */}
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                              {/* Description */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '14px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {t.description || t.category}
                                </div>
                                {t.category && (
                                  <div style={{ fontSize: '11px', color: dotColor, marginTop: '1px', letterSpacing: '0.05em' }}>{t.category}</div>
                                )}
                              </div>
                              {/* Amount */}
                              <span className="blur-value" style={{ fontSize: '15px', color: 'var(--negative)', fontFamily: 'var(--font-num)', flexShrink: 0 }}>
                                -{fmtAmt(Math.abs(t.amount))}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </>
                )
              })()}
              {expenses.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px', padding: '8px 4px', borderTop: '1px solid var(--border)', marginTop: '4px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>MONTH TOTAL</span>
                  <span className="blur-value" style={{ fontSize: '14px', color: 'var(--accent)', fontFamily: 'var(--font-num)' }}>
                    {monthDisplay}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Widget>
  )
}
