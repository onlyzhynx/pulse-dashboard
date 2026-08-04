import { useState, useEffect } from 'react'

import YearlyWidget            from '../widgets/YearlyWidget'
import NetWorthWidget          from '../widgets/NetWorthWidget'
import CryptoTickerWidget      from '../widgets/CryptoTickerWidget'
import WalletsWidget           from '../widgets/WalletsWidget'
import PortfolioHistoryWidget  from '../widgets/PortfolioHistoryWidget'
import HoldingsWidget          from '../widgets/HoldingsWidget'
import BankAccountsWidget      from '../widgets/BankAccountsWidget'
import CashFlowWidget          from '../widgets/CashFlowWidget'
import SpendingWidget          from '../widgets/SpendingWidget'
import TransactionsWidget      from '../widgets/TransactionsWidget'
import MonthlyWidget           from '../widgets/MonthlyWidget'
import HomeKpis                from '../widgets/HomeKpis'
import RecurringWidget         from '../widgets/RecurringWidget'
import HyperliquidWidget       from '../widgets/HyperliquidWidget'
import MeteoraWidget           from '../widgets/MeteoraWidget'
import TopBar                  from './TopBar'

function useIsMobile(bp = 768) {
  const [v, setV] = useState(() => window.innerWidth < bp)
  useEffect(() => {
    const h = () => setV(window.innerWidth < bp)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [bp])
  return v
}

// ── Tab definitions ──────────────────────────────────────────
const TABS = [
  { id: 'transactions', label: 'Transactions',  shortLabel: 'Txs',     icon: '≡' },
  { id: 'monthly',      label: 'Monthly',       shortLabel: 'Month',   icon: '⬡' },
  { id: 'overview',     label: 'Home',          shortLabel: 'Home',    icon: '◈' },
  { id: 'history',      label: 'History',       shortLabel: 'History', icon: '◎' },
  { id: 'crypto',       label: 'Crypto',        shortLabel: 'Crypto',  icon: '⬟' },
]

// ── Tab SVG icons ────────────────────────────────────────────
const TAB_ICONS = {
  transactions: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 5h14M3 10h14M3 15h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  monthly: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M3 8h14" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M7 2v3M13 2v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  overview: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 10L10 3l7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 8.5V16a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  history: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 10a6.5 6.5 0 1 0 1.2-3.8L3 4.5V8h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 7v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  crypto: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2l2.5 5h5l-4 3.5 1.5 5.5L10 13l-5 3 1.5-5.5L2.5 7h5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  ),
}

// ── Mobile bottom nav ────────────────────────────────────────
function MobileNav({ active, onSwitch }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0, left: 0, right: 0,
      height: 'calc(58px + env(safe-area-inset-bottom))',
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: 'var(--bg-card)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      zIndex: 200,
    }}>
      {TABS.map(tab => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              cursor: 'pointer',
              fontFamily: 'var(--font)',
              fontSize: '10px',
              letterSpacing: '0.08em',
              transition: 'color 0.15s',
            }}
          >
            {TAB_ICONS[tab.id]}
            {tab.shortLabel.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

// ── Mobile stacks per tab ────────────────────────────────────
const MOBILE_STACKS = {
  overview: [
    { key: 'networth',     Component: NetWorthWidget,     height: 240 },
    { key: 'bank',         Component: BankAccountsWidget, height: 280 },
    { key: 'transactions', Component: TransactionsWidget, height: 520 },
  ],
  transactions: [
    { key: 'transactions', Component: TransactionsWidget, height: 560 },
  ],
  monthly: [
    { key: 'monthly',   Component: MonthlyWidget,   height: 480 },
    { key: 'spending',  Component: SpendingWidget,  height: 360 },
    { key: 'recurring', Component: RecurringWidget, height: 360 },
  ],
  history: [
    { key: 'portfolio', Component: PortfolioHistoryWidget, height: 340 },
    { key: 'cashflow',  Component: CashFlowWidget,         height: 440 },
    { key: 'yearly',    Component: YearlyWidget,           height: 700 },
  ],
  crypto: [
    { key: 'ticker',      Component: CryptoTickerWidget, height: 220 },
    { key: 'wallets',     Component: WalletsWidget,      height: 340 },
    { key: 'hyperliquid', Component: HyperliquidWidget,  height: 360 },
    { key: 'meteora',     Component: MeteoraWidget,      height: 360 },
    { key: 'holdings',    Component: HoldingsWidget,     height: 480 },
  ],
}

// ── Dashboard ────────────────────────────────────────────────
export default function Dashboard() {
  const isMobile = useIsMobile(768)
  // Boxless layout needs wide gutters since whitespace is the only separator
  const gap = '32px'

  const [activeTab, setActiveTab] = useState(
    () => localStorage.getItem('pulse-tab') || 'overview'
  )
  const [histView, setHistView] = useState('charts') // 'charts' | 'yearly'

  const switchTab = (id) => {
    setActiveTab(id)
    localStorage.setItem('pulse-tab', id)
  }

  return (
    <div style={{ background: 'var(--bg)', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar tabs={TABS} activeTab={activeTab} onSwitchTab={switchTab} />

      {isMobile ? (
        /* ── Mobile: stacked cards ──────────────────────── */
        <div style={{
          flex: 1,
          padding: '10px 10px 70px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          overflowY: 'auto',
        }}>
          {MOBILE_STACKS[activeTab].map(({ key, Component, height }) => (
            <div key={key} style={{ height, flexShrink: 0 }}>
              <Component />
            </div>
          ))}
        </div>
      ) : (
        /* ── Desktop: content area ──────────────────────── */
        <div style={{ flex: 1, minHeight: 0, padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>

          {/* ── HOME: KPI cards on top, detail below ── */}
          {activeTab === 'overview' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap }}>
              <HomeKpis />
              <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap }}>
                {/* Left: portfolio chart over the activity feed */}
                <div style={{ display: 'flex', flexDirection: 'column', gap, minHeight: 0 }}>
                  <div style={{ flex: '1 1 42%', minHeight: 0 }}><PortfolioHistoryWidget /></div>
                  <div style={{ flex: '1 1 58%', minHeight: 0 }}><TransactionsWidget title="Recent Activity" /></div>
                </div>
                {/* Right: balances */}
                <div style={{ minHeight: 0 }}><BankAccountsWidget /></div>
              </div>
            </div>
          )}

          {/* ── TRANSACTIONS: full width + insights sidebar ── */}
          {activeTab === 'transactions' && (
            <div style={{ flex: 1, minHeight: 0 }}>
              <TransactionsWidget wide />
            </div>
          )}

          {/* ── MONTHLY: hero analysis + supporting stack ── */}
          {activeTab === 'monthly' && (
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap }}>
              <MonthlyWidget />
              <div style={{ display: 'flex', flexDirection: 'column', gap, minHeight: 0 }}>
                <div style={{ flex: '1 1 55%', minHeight: 0 }}><SpendingWidget /></div>
                <div style={{ flex: '1 1 45%', minHeight: 0 }}><RecurringWidget /></div>
              </div>
            </div>
          )}

          {/* ── HISTORY: charts + yearly ── */}
          {activeTab === 'history' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Sub-toggle */}
              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                {[{ id: 'charts', label: 'Charts' }, { id: 'yearly', label: 'Yearly' }].map(v => (
                  <button key={v.id} onClick={() => setHistView(v.id)}
                    className={histView === v.id ? 'btn-active' : 'btn-ghost'}
                    style={{ fontSize: '12px', padding: '3px 12px' }}>{v.label}</button>
                ))}
              </div>
              {histView === 'charts' ? (
                <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap }}>
                  <PortfolioHistoryWidget />
                  <CashFlowWidget />
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <YearlyWidget />
                </div>
              )}
            </div>
          )}

          {/* ── CRYPTO: ticker + wallets + holdings, with perps below ── */}
          {activeTab === 'crypto' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap }}>
              <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 3fr 4fr', gap }}>
                <CryptoTickerWidget />
                <WalletsWidget />
                <HoldingsWidget />
              </div>
              <div style={{ flexShrink: 0, height: '320px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap }}>
                <HyperliquidWidget />
                <MeteoraWidget />
              </div>
            </div>
          )}

        </div>
      )}

      {/* Mobile bottom nav */}
      {isMobile && <MobileNav active={activeTab} onSwitch={switchTab} />}
    </div>
  )
}
