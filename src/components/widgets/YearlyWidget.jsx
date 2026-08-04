import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

import { CATEGORY_COLORS } from '../../utils/colors'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function YearlyWidget() {
  const { currency, fromUSD } = useCurrency()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [monthData, setMonthData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const months = Array.from({ length: 12 }, (_, i) =>
      `${year}-${String(i + 1).padStart(2, '0')}`
    )
    Promise.all(
      months.map(m =>
        fetch(`/api/bank/monthly?month=${m}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      setMonthData(results.map((d, i) => ({
        month: MONTHS[i],
        monthKey: months[i],
        income: d?.total_in ?? 0,
        expenses: Math.abs(d?.total_out ?? 0),
        net: (d?.total_in ?? 0) - Math.abs(d?.total_out ?? 0),
        categories: d?.by_category ?? {},
      })))
      setLoading(false)
    })
  }, [year])

  const fmtAmt = v => fmt.currency(fromUSD(v), currency)

  const totalIncome   = monthData.reduce((s, m) => s + m.income, 0)
  const totalExpenses = monthData.reduce((s, m) => s + m.expenses, 0)
  const netTotal      = totalIncome - totalExpenses

  const bestMonth  = [...monthData].sort((a, b) => b.net - a.net)[0]
  const worstMonth = [...monthData].filter(m => m.expenses > 0).sort((a, b) => a.net - b.net)[0]

  // Aggregate category spending
  const catTotals = {}
  monthData.forEach(m => {
    Object.entries(m.categories).forEach(([cat, val]) => {
      if (val < 0) catTotals[cat] = (catTotals[cat] || 0) + Math.abs(val)
    })
  })
  const topCats = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    return (
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        padding: '8px 12px', borderRadius: 'var(--radius)',
        fontFamily: 'var(--font)', fontSize: '13px', color: 'var(--text)',
      }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>{label}</div>
        <div style={{ color: 'var(--positive)' }}>In: {fmtAmt(d?.income ?? 0)}</div>
        <div style={{ color: 'var(--negative)' }}>Out: {fmtAmt(d?.expenses ?? 0)}</div>
        <div style={{ color: d?.net >= 0 ? 'var(--positive)' : 'var(--negative)', marginTop: '2px' }}>
          Net: {fmtAmt(d?.net ?? 0)}
        </div>
      </div>
    )
  }

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  return (
    <Widget
      title="Yearly Overview"
      subtitle={`${year}`}
      actions={
        <div style={{ display: 'flex', gap: '3px' }}>
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={year === y ? 'btn-active' : 'btn-ghost'}
              style={{ fontSize: '12px', padding: '2px 8px' }}>{y}</button>
          ))}
        </div>
      }
    >
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflow: 'auto' }}>

          {/* ── Totals ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            {[
              { label: 'Total In',  value: fmtAmt(totalIncome),   color: 'var(--positive)' },
              { label: 'Total Out', value: fmtAmt(totalExpenses),  color: 'var(--negative)' },
              { label: 'Net',       value: fmtAmt(netTotal),       color: netTotal >= 0 ? 'var(--positive)' : 'var(--negative)' },
            ].map(item => (
              <div key={item.label} style={{
                padding: '12px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
              }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '4px' }}>{item.label}</div>
                <div className="blur-value" style={{ fontSize: '16px', fontWeight: 700, color: item.color, fontFamily: 'var(--font-num)' }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {/* ── Best / Worst month ── */}
          {(bestMonth || worstMonth) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {bestMonth && bestMonth.net !== 0 && (
                <div style={{ padding: '10px', borderRadius: 'var(--radius)', border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.05)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>BEST MONTH</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginTop: '2px' }}>{bestMonth.month}</div>
                  <div className="blur-value" style={{ fontSize: '13px', color: 'var(--positive)', marginTop: '1px' }}>+{fmtAmt(bestMonth.net)}</div>
                </div>
              )}
              {worstMonth && (
                <div style={{ padding: '10px', borderRadius: 'var(--radius)', border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>WORST MONTH</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', marginTop: '2px' }}>{worstMonth.month}</div>
                  <div className="blur-value" style={{ fontSize: '13px', color: 'var(--negative)', marginTop: '1px' }}>{fmtAmt(worstMonth.net)}</div>
                </div>
              )}
            </div>
          )}

          {/* ── Monthly chart ── */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>MONTHLY BREAKDOWN</div>
            <div style={{ height: '160px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barGap={2}>
                  <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font)' }}
                    axisLine={false} tickLine={false} />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="income" radius={[2,2,0,0]} maxBarSize={14}>
                    {monthData.map((_, i) => <Cell key={i} fill="var(--positive)" opacity={0.7} />)}
                  </Bar>
                  <Bar dataKey="expenses" radius={[2,2,0,0]} maxBarSize={14}>
                    {monthData.map((_, i) => <Cell key={i} fill="var(--negative)" opacity={0.7} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Top spending categories ── */}
          {topCats.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>TOP SPENDING CATEGORIES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {topCats.map(([cat, val]) => {
                  const color = CATEGORY_COLORS[cat] ?? '#94a3b8'
                  const pct = totalExpenses > 0 ? (val / totalExpenses) * 100 : 0
                  return (
                    <div key={cat}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                          <span style={{ fontSize: '13px', color: 'var(--text)' }}>{cat}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
                          <span className="blur-value" style={{ fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--font-num)', minWidth: '80px', textAlign: 'right' }}>
                            {fmtAmt(val)}
                          </span>
                        </div>
                      </div>
                      <div style={{ height: '2px', background: 'var(--border)', borderRadius: '1px' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '1px', transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Widget>
  )
}
