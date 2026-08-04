import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CurrencyProvider } from './context/CurrencyContext'
import LoginScreen from './components/auth/LoginScreen'
import Dashboard from './components/layout/Dashboard'

function AppInner() {
  const { authed, loading } = useAuth()
  if (loading) return null
  return authed ? <Dashboard /> : <LoginScreen />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CurrencyProvider>
          <AppInner />
        </CurrencyProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
