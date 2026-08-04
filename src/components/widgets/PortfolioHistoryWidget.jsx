import { useState, useEffect, useRef } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

const RANGES = ['7D', '1M', '3M', '6M', '1Y', 'ALL']

export default function PortfolioHistoryWidget() {
  const { currency, fromUSD } = useCurrency()
  const [data, setData] = useState([])
  const [range, setRange] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [goal, setGoal] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pulse-nw-goal') || 'null') } catch { return null }
  })
  const [showGoalInput, setShowGoalInput] = useState(false)
  const [goalInput, setGoalInput] = useState('')
  const goalRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/portfolio/history?range=${range}`)
      .then(r => r.json())
      .then(d => { setData(d.snapshots || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [range])

  const chartData = data.map(s => ({
    date: new Date(s.captured_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: data.length > 100 ? '2-digit' : undefined }),
    value: fromUSD(s.value),
    raw: s.value,
  }))

  const latest = fromUSD(data[data.length - 1]?.value ?? 0)
  const first = fromUSD(data[0]?.value ?? 0)
  const delta = latest - first
  const deltaPct = first > 0 ? (delta / first) * 100 : 0
  const isUp = delta >= 0

  // Range stats: high / low / max drawdown over the selected window
  const values = chartData.map(d => d.value)
  const high = values.length ? Math.max(...values) : 0
  const low = values.length ? Math.min(...values) : 0
  let peak = -Infinity, maxDD = 0
  for (const v of values) {
    if (v > peak) peak = v
    if (peak > 0) maxDD = Math.min(maxDD, (v - peak) / peak)
  }

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--accent)',
        padding: '8px 12px',
        borderRadius: 'var(--radius)',
        fontFamily: 'var(--font)',
        fontSize: '14px',
        color: 'var(--text)',
      }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '2px' }}>{payload[0].payload.date}</div>
        <div style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmt.currency(payload[0].value, currency)}</div>
      </div>
    )
  }

  return (
    <Widget
      title="Portfolio History"
      subtitle={data.length > 0 ? `${data.length} snapshots` : undefined}
      actions={
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={range === r ? 'btn-active' : 'btn-ghost'}
              style={{ fontSize: '12px', padding: '2px 9px' }}
            >
              {r}
            </button>
          ))}
          <div style={{ position: 'relative' }} ref={goalRef}>
            <button
              onClick={() => { setShowGoalInput(v => !v); setGoalInput(goal ? String(goal.value) : '') }}
              className={goal ? 'btn-active' : 'btn-ghost'}
              style={{ fontSize: '12px', padding: '2px 7px' }}
              title="Set net worth goal"
            >◎ {goal ? fmt.currency(fromUSD(goal.value), currency).split('.')[0] : 'Goal'}</button>
            {showGoalInput && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
                borderRadius: 'var(--radius)', padding: '10px', zIndex: 200,
                display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px',
                boxShadow: 'var(--shadow)',
              }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>GOAL (USD)</div>
                <input
                  type="number" placeholder="e.g. 500000"
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '14px', padding: '5px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = parseFloat(goalInput)
                      if (!isNaN(v)) { const g = { value: v }; setGoal(g); localStorage.setItem('pulse-nw-goal', JSON.stringify(g)) }
                      setShowGoalInput(false)
                    }
                  }}
                />
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => {
                    const v = parseFloat(goalInput)
                    if (!isNaN(v)) { const g = { value: v }; setGoal(g); localStorage.setItem('pulse-nw-goal', JSON.stringify(g)) }
                    setShowGoalInput(false)
                  }} className="btn-primary" style={{ flex: 1, fontSize: '12px', padding: '4px' }}>Set</button>
                  {goal && <button onClick={() => { setGoal(null); localStorage.removeItem('pulse-nw-goal'); setShowGoalInput(false) }}
                    className="btn-ghost" style={{ fontSize: '12px', padding: '4px 8px' }}>Clear</button>}
                </div>
              </div>
            )}
          </div>
        </div>
      }
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Summary */}
        <div style={{ marginBottom: '8px', display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="blur-value" style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-num)', color: 'var(--text)' }}>
            {fmt.currency(latest, currency)}
          </span>
          <span className="blur-value" style={{ fontSize: '14px', color: isUp ? 'var(--positive)' : 'var(--negative)' }}>
            {isUp ? '▲' : '▼'} {fmt.currency(Math.abs(delta), currency)}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            ({isUp ? '+' : ''}{deltaPct.toFixed(1)}%)
          </span>
          {values.length > 1 && (
            <span className="blur-value" style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'var(--font-num)' }}>
              H {fmt.compact(high, currency)} · L {fmt.compact(low, currency)} · DD {(maxDD * 100).toFixed(1)}%
            </span>
          )}
        </div>

        {/* Chart — fills whatever height the tab gives it */}
        <div style={{ flex: 1, minHeight: '200px' }}>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading…</div>
          ) : chartData.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No data. Run <code style={{ color: 'var(--accent)' }}>npm run migrate</code> to import history.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-line)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--chart-line)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font)' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={70}
                  tickMargin={8}
                />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--chart-line)"
                  strokeWidth={2}
                  fill="url(#chartGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--chart-line)', strokeWidth: 0 }}
                />
                {goal && (
                  <ReferenceLine
                    y={fromUSD(goal.value)}
                    stroke="var(--accent)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                    label={{ value: 'Goal', position: 'right', fill: 'var(--accent)', fontSize: 9, fontFamily: 'var(--font)' }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Widget>
  )
}
