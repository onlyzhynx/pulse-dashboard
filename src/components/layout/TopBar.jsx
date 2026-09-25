import { useState, useRef, useEffect } from 'react'
import { useTheme, THEMES } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useCurrency } from '../../context/CurrencyContext'
import SettingsPanel from './SettingsPanel'

function useIsMobile(breakpoint = 520) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])
  return isMobile
}

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€' }

export default function TopBar({ tabs, activeTab, onSwitchTab }) {
  const { theme, setTheme } = useTheme()
  const { logout } = useAuth()
  const { currency, setCurrency } = useCurrency()
  const [themeOpen, setThemeOpen]       = useState(false)
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Privacy blur persists across reloads — you enabled it for a reason
  const [blurred, setBlurred]           = useState(() => localStorage.getItem('pulse-blurred') === '1')

  useEffect(() => {
    document.body.classList.toggle('values-blurred', blurred)
  }, [blurred])

  const toggleBlur = () => {
    setBlurred(v => {
      localStorage.setItem('pulse-blurred', v ? '0' : '1')
      return !v
    })
  }
  const dropRef     = useRef(null)
  const currencyRef = useRef(null)
  const isMobile    = useIsMobile()

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target))         setThemeOpen(false)
      if (currencyRef.current && !currencyRef.current.contains(e.target)) setCurrencyOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentTheme = THEMES.find(t => t.id === theme) ?? THEMES[0]

  const dropMenuStyle = {
    position: 'absolute', top: 'calc(100% + 6px)', right: 0,
    background: 'var(--bg-card)', border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)', padding: '6px',
    display: 'flex', flexDirection: 'column', gap: '2px',
    zIndex: 200, boxShadow: 'var(--shadow)',
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center',
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: '16px', paddingRight: '16px',
        height: 'calc(56px + env(safe-area-inset-top))',
        borderBottom: 'none',
        background: theme === 'light' ? 'rgba(246,248,247,0.8)' : 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 1px 0 var(--border)',
        position: 'sticky', top: 0, zIndex: 100, flexShrink: 0,
        gap: '12px',
      }}>

        {/* ── Left: Pulse brand ── */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img
            src={theme === 'light' ? '/pulse-mark-dark.svg' : '/pulse-mark-light.svg'}
            alt=""
            aria-hidden="true"
            width="28"
            height="28"
            style={{ display: 'block' }}
          />
          <div style={{
            fontFamily: 'var(--font)',
            fontSize: '16px',
            fontWeight: 800,
            letterSpacing: '0.16em',
            color: 'var(--text)',
            userSelect: 'none',
          }}>
            PULSE
          </div>
        </div>

        {/* ── Center: tab pills (desktop only) ── */}
        {!isMobile && tabs && (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '4px' }}>
            {tabs.map(tab => {
              const isActive = activeTab === tab.id
              return (
                <button key={tab.id} onClick={() => onSwitchTab(tab.id)}
                  onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' } }}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
                  style={{
                    background: isActive ? 'var(--accent-dim)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                    borderRadius: '9999px',
                    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                    fontFamily: 'var(--font)', fontSize: '13px',
                    fontWeight: isActive ? 700 : 500,
                    letterSpacing: '0.01em',
                    padding: '5px 15px',
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    whiteSpace: 'nowrap',
                    boxShadow: isActive ? '0 0 18px var(--accent-dim)' : 'none',
                  }}>
                  <span style={{ fontSize: '13px', opacity: isActive ? 1 : 0.5 }}>{tab.icon}</span>
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Right: currency + theme + settings + logout ── */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>

          {/* Currency — pills on desktop, dropdown on mobile */}
          {isMobile ? (
            <div ref={currencyRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setCurrencyOpen(v => !v)}
                className={currencyOpen ? 'btn-active' : 'btn-ghost'}
                style={{ fontSize: '13px', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {CURRENCY_SYMBOLS[currency]}
                <span style={{ fontSize: '9px', opacity: 0.7 }}>{currencyOpen ? '▲' : '▼'}</span>
              </button>
              {currencyOpen && (
                <div style={{ ...dropMenuStyle, minWidth: '90px' }}>
                  {['USD', 'EUR'].map(c => (
                    <button
                      key={c}
                      onClick={() => { setCurrency(c); setCurrencyOpen(false) }}
                      style={{
                        background: currency === c ? 'var(--accent-dim)' : 'transparent',
                        border: currency === c ? '1px solid var(--accent)' : '1px solid transparent',
                        borderRadius: 'var(--radius)',
                        color: currency === c ? 'var(--accent)' : 'var(--text-muted)',
                        fontFamily: 'var(--font)', fontSize: '13px',
                        padding: '6px 10px', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', gap: '6px', alignItems: 'center',
                      }}
                    >
                      <span style={{ width: '18px', fontWeight: '600' }}>{CURRENCY_SYMBOLS[c]}</span>
                      <span style={{ fontSize: '12px', opacity: 0.7 }}>{c}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '3px' }}>
              {['USD', 'EUR'].map(c => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={currency === c ? 'btn-active' : 'btn-ghost'}
                  style={{ fontSize: '12px', padding: '3px 8px' }}
                >{c}</button>
              ))}
            </div>
          )}

          {/* Theme dropdown — desktop only */}
          {!isMobile && <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />}
          {!isMobile && <div ref={dropRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setThemeOpen(v => !v)}
              className={themeOpen ? 'btn-active' : 'btn-ghost'}
              style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '5px' }}
              title="Change theme"
            >
              {isMobile ? (
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6.5" cy="6.5" r="5.75" stroke="currentColor" strokeWidth="1.4"/>
                  <circle cx="4" cy="5.5" r="1" fill="currentColor"/>
                  <circle cx="9" cy="5.5" r="1" fill="currentColor"/>
                  <circle cx="6.5" cy="9" r="1" fill="currentColor"/>
                </svg>
              ) : (
                <>
                  <span style={{ fontSize: '12px' }}>{currentTheme.label}</span>
                  <span style={{ fontSize: '9px', opacity: 0.7 }}>{themeOpen ? '▲' : '▼'}</span>
                </>
              )}
            </button>

            {themeOpen && (
              <div style={{ ...dropMenuStyle, minWidth: '160px' }}>
                {THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTheme(t.id); setThemeOpen(false) }}
                    style={{
                      background: theme === t.id ? 'var(--accent-dim)' : 'transparent',
                      border: theme === t.id ? '1px solid var(--accent)' : '1px solid transparent',
                      borderRadius: 'var(--radius)',
                      color: theme === t.id ? 'var(--accent)' : 'var(--text-muted)',
                      fontFamily: 'var(--font)', fontSize: '13px',
                      padding: '6px 10px', cursor: 'pointer', textAlign: 'left',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      gap: '10px', transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { if (theme !== t.id) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' } }}
                    onMouseLeave={e => { if (theme !== t.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
                  >
                    <span style={{ letterSpacing: '0.08em' }}>{t.label}</span>
                    <span style={{ fontSize: '11px', opacity: 0.6 }}>{t.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>}

          {!isMobile && <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />}

          {/* Privacy blur */}
          <button
            onClick={toggleBlur}
            className={blurred ? 'btn-active' : 'btn-ghost'}
            title={blurred ? 'Show values' : 'Hide values'}
            style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
          >
            {blurred ? (
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L13 9M5.5 2.2A5.3 5.3 0 0 1 7 2c3 0 5.5 3 5.5 3s-.8 1.2-2 2.1M2.5 4.5C1.5 5.3 1 6 1 6s2.5 3 6 3a6 6 0 0 0 2-.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 5s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4Z" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="7" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
            )}
          </button>

          {/* Settings */}
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className={settingsOpen ? 'btn-active' : 'btn-ghost'}
            style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
            title="Settings"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="6.5" cy="6.5" r="1.75" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.4 2.4l.85.85M9.75 9.75l.85.85M2.4 10.6l.85-.85M9.75 3.25l.85-.85" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Logout — desktop only; on mobile use settings panel */}
          {!isMobile && (
            <button
              onClick={logout}
              className="btn-ghost"
              style={{ padding: '4px 8px', display: 'flex', alignItems: 'center' }}
              title="Logout"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.5 1.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M9.2 3.3a5 5 0 1 1-5.4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
