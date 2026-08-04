import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

export default function LoginScreen() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await login(password)
    if (!result.ok) setError(result.error || 'Access denied')
    setLoading(false)
  }

  return (
    <div className="login-container">
      <div style={{
        width: '100%',
        maxWidth: '320px',
        padding: '0 24px'
      }}>
        {/* Logo / Title */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            fontFamily: 'var(--font)',
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.3em',
            color: 'var(--accent)',
            marginBottom: '8px',
          }}>PULSE</div>
          <div style={{
            fontFamily: 'var(--font-num)',
            fontSize: '12px',
            letterSpacing: '0.2em',
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
          }}>NET WORTH TERMINAL</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              style={{
                width: '100%',
                background: 'var(--bg-card)',
                border: `1px solid ${error ? 'var(--negative)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontFamily: 'var(--font)',
                fontSize: '15px',
                padding: '12px 14px',
                outline: 'none',
                transition: 'border-color 0.15s'
              }}
              onFocus={e => e.target.style.borderColor = 'var(--border-bright)'}
              onBlur={e => e.target.style.borderColor = error ? 'var(--negative)' : 'var(--border)'}
            />
          </div>

          {error && (
            <div style={{
              fontFamily: 'var(--font)',
              fontSize: '13px',
              color: 'var(--negative)',
              marginBottom: '12px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%',
              background: loading ? 'var(--bg-card)' : 'var(--accent)',
              color: loading ? 'var(--text-muted)' : '#fff',
              border: 'none',
              borderRadius: '20px',
              fontFamily: 'var(--font)',
              fontSize: '14px',
              fontWeight: '600',
              padding: '12px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s'
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
