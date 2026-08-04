import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

import { CATEGORY_COLORS } from '../../utils/colors'

function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function fmtMonth(m) {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function MonthlyWidget() {
  const { currency, fromUSD } = useCurrency()
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/bank/monthly?month=${month}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [month])

  const fmtAmt = (usd) => fmt.currency(fromUSD(usd), currency)

  // Top categories (expenses only, descending by abs)
  const topCats = data?.byCategory
    ? [...data.byCategory].sort((a, b) => a.total - b.total).slice(0, 8)
    : []
  const maxAbs = topCats.length > 0 ? Math.abs(topCats[0].total) : 1

  // Weekly chart data
  const weeklyData = ['W1', 'W2', 'W3', 'W4'].map(w => {
    const found = data?.byWeek?.find(x => x.week === w)
    return { week: w, spent: found?.spent || 0 }
  })

  const pieData = topCats.map(({ category, total }) => ({
    name: category || 'Other',
    value: Math.abs(total),
  }))

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        padding: '6px 10px', borderRadius: 'var(--radius)',
        fontFamily: 'var(--font)', fontSize: '13px', color: 'var(--text)',
      }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{payload[0].payload.week}</div>
        <div>{fmtAmt(payload[0].value)}</div>
      </div>
    )
  }

  const PieTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const { name, value } = payload[0].payload
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        padding: '6px 10px', borderRadius: 'var(--radius)',
        fontFamily: 'var(--font)', fontSize: '13px', color: 'var(--text)',
      }}>
        <div style={{ color: CATEGORY_COLORS[name] ?? '#94a3b8', marginBottom: '2px', fontWeight: 600 }}>{name}</div>
        <div>{fmtAmt(value)}</div>
      </div>
    )
  }

  return (
    <Widget
      title="Monthly Overview"
      subtitle={fmtMonth(month)}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button onClick={() => setMonth(prevMonth(month))} className="btn-ghost"
            title="Previous month" style={{ fontSize: '14px', padding: '2px 10px', lineHeight: 1 }}>‹</button>
          {month !== thisMonth && (
            <button onClick={() => setMonth(thisMonth)} className="btn-ghost"
              style={{ fontSize: '12px', padding: '2px 10px' }}>Today</button>
          )}
          <button onClick={() => setMonth(nextMonth(month))} className="btn-ghost"
            disabled={month >= thisMonth}
            title="Next month"
            style={{ fontSize: '14px', padding: '2px 10px', lineHeight: 1, opacity: month >= thisMonth ? 0.3 : 1 }}>›</button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '14px' }}>

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', marginTop: '20px' }}>Loading…</div>
        ) : !data ? null : (
          <>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', flexShrink: 0 }}>
              {[
                {
                  label: 'MONEY IN', val: data.income, color: 'var(--positive)', sign: '+',
                  sub: data.cashoutIncome > 0
                    ? `${data.cashoutCount} cashout${data.cashoutCount !== 1 ? 's' : ''}`
                    : null,
                },
                { label: 'MONEY OUT', val: Math.abs(data.expenses), color: 'var(--negative)', sign: '-', sub: null },
                {
                  label: 'NET', val: Math.abs(data.net),
                  color: data.net >= 0 ? 'var(--positive)' : 'var(--negative)',
                  sign: data.net >= 0 ? '+' : '-', sub: null,
                },
              ].map(({ label, val, color, sign, sub }) => (
                <div key={label} className="kpi-tile" style={{ padding: '13px 16px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '6px' }}>{label}</div>
                  <div className="blur-value" style={{ fontSize: '20px', fontWeight: 700, color, fontFamily: 'var(--font-num)', lineHeight: 1 }}>
                    {sign}{fmtAmt(val)}
                  </div>
                  {sub && <div style={{ fontSize: '11px', color: 'var(--positive)', marginTop: '5px', letterSpacing: '0.06em', opacity: 0.8 }}>{sub}</div>}
                </div>
              ))}
            </div>

            {/* Main: donut + category breakdown, fills remaining height */}
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: '18px' }}>

              {/* Donut */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.1em', flexShrink: 0, marginBottom: '6px' }}>SPENDING</div>
                {pieData.length === 0 ? (
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No spending this month</div>
                ) : (
                  <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius="58%" outerRadius="84%"
                          dataKey="value" paddingAngle={2} startAngle={90} endAngle={-270}>
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={CATEGORY_COLORS[entry.name] ?? '#94a3b8'} strokeWidth={0} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex',
                      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>SPENT</div>
                      <div className="blur-value" style={{ fontSize: '18px', color: 'var(--text)', fontFamily: 'var(--font-num)', fontWeight: 600 }}>
                        {fmtAmt(Math.abs(data.expenses))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Category breakdown — fills vertical space */}
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.1em', flexShrink: 0, marginBottom: '8px' }}>BY CATEGORY</div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {topCats.length === 0 ? (
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>—</div>
                  ) : topCats.map(({ category, total }) => {
                    const name = category || 'Other'
                    const color = CATEGORY_COLORS[name] ?? '#94a3b8'
                    const pct = maxAbs > 0 ? Math.abs(total) / maxAbs * 100 : 0
                    const share = data.expenses ? Math.abs(total) / Math.abs(data.expenses) * 100 : 0
                    return (
                      <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color }} />
                          <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                          <span style={{ color: 'var(--text-dim)', fontSize: '11px', flexShrink: 0 }}>{share.toFixed(0)}%</span>
                          <span className="blur-value" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-num)', minWidth: '64px', textAlign: 'right', flexShrink: 0 }}>{fmtAmt(Math.abs(total))}</span>
                        </div>
                        <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '2px' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Weekly spending — full-width strip at the bottom */}
            <div style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>WEEKLY SPENDING</span>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  {data.byCategory?.reduce((s, c) => s + c.count, 0) || 0} txns · avg {fmtAmt(Math.abs(data.expenses) / 4)}/wk
                </span>
              </div>
              <div style={{ height: '92px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="week" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font)' }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="spent" radius={[4, 4, 0, 0]} maxBarSize={64}>
                      {weeklyData.map((_, i) => (
                        <Cell key={i} fill="var(--accent)" opacity={0.7 + i * 0.075} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </Widget>
  )
}
