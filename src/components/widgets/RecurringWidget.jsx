import { useState, useEffect } from 'react'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'
import { useCurrency } from '../../context/CurrencyContext'

const CADENCE_LABEL = { weekly: 'wk', monthly: 'mo', quarterly: 'qtr', yearly: 'yr' }

import { CATEGORY_COLORS } from '../../utils/colors'

export default function RecurringWidget() {
  const { currency, fromUSD } = useCurrency()
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch('/api/bank/recurring').then(r => r.ok ? r.json() : null).then(setData).catch(() => {})
  }, [])

  const fmtAmt = (usd) => fmt.currency(fromUSD(usd), currency)
  const list = data?.recurring || []

  return (
    <Widget
      title="Subscriptions"
      subtitle={data ? `${fmtAmt(data.monthlyTotal)} / mo · ${list.length} recurring` : '…'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {!data ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>Loading…</div>
        ) : list.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '8px 0' }}>
            No recurring charges detected — needs a couple months of transactions.
          </div>
        ) : (
          <div className="alt-rows" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            {list.map(r => {
              const color = CATEGORY_COLORS[r.category] ?? '#94a3b8'
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 4px', borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.label}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '1px', letterSpacing: '0.03em' }}>
                      {r.category} · next ~{r.nextDate?.slice(5)} · {r.count}×
                    </div>
                  </div>
                  <div className="blur-value" style={{ textAlign: 'right', flexShrink: 0, fontFamily: 'var(--font-num)' }}>
                    <span style={{ fontSize: '14px', color: 'var(--text)' }}>{fmtAmt(r.avgAmount)}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}> /{CADENCE_LABEL[r.cadence] || 'mo'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', paddingTop: '6px', flexShrink: 0 }}>
          Estimated from repeating transactions
        </div>
      </div>
    </Widget>
  )
}
