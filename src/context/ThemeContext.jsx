import { createContext, useContext, useState, useEffect } from 'react'

export const THEMES = [
  { id: 'flow',  label: 'Dark',  desc: 'Boxless dark' },
  { id: 'light', label: 'Light', desc: 'Boxless light' },
]

const VALID = new Set(THEMES.map(t => t.id))

// Map retired theme ids onto the closest Flow variant
const MIGRATE = { clean: 'flow', soft: 'light', cyber: 'flow' }

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('pulse-theme')
    if (VALID.has(saved)) return saved
    return MIGRATE[saved] || 'flow'
  })

  const setTheme = (t) => {
    if (!VALID.has(t)) t = 'flow'
    setThemeState(t)
    localStorage.setItem('pulse-theme', t)
  }

  useEffect(() => {
    // Swap only theme-* classes — a blanket className assignment would wipe
    // unrelated body classes like values-blurred (privacy toggle).
    THEMES.forEach(t => document.body.classList.remove(`theme-${t.id}`))
    document.body.classList.add(`theme-${theme}`)
  }, [theme])

  const toggleTheme = () => setTheme(theme === 'flow' ? 'light' : 'flow')

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
