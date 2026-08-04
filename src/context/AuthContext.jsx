import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => { setAuthed(d.authenticated); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Session expired mid-use (fetchCache dispatches this on any API 401) —
  // drop back to the login screen instead of showing an empty dashboard.
  useEffect(() => {
    const onUnauthorized = () => setAuthed(false)
    window.addEventListener('pulse:unauthorized', onUnauthorized)
    return () => window.removeEventListener('pulse:unauthorized', onUnauthorized)
  }, [])

  const login = async (password) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
    const d = await r.json()
    if (d.ok) setAuthed(true)
    return d
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthed(false)
  }

  return (
    <AuthContext.Provider value={{ authed, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
