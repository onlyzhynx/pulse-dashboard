import { createContext, useContext, useState, useEffect } from 'react'

const CurrencyContext = createContext(null)

const FALLBACK_RATES = { USD: 1, EUR: 0.92 }

export function CurrencyProvider({ children }) {
  const [currency, setCurrencyState] = useState(
    () => localStorage.getItem('pulse-currency') || 'USD'
  )
  const [rates, setRates] = useState(FALLBACK_RATES)

  useEffect(() => {
    fetch('/api/currency/rates')
      .then(r => r.json())
      .then(d => { if (d.rates) setRates(d.rates) })
      .catch(() => {})
  }, [])

  const setCurrency = (c) => {
    setCurrencyState(c)
    localStorage.setItem('pulse-currency', c)
  }

  // Every amount is stored in USD — convert only at display time.
  const fromUSD = (usdValue) => {
    if (!usdValue || isNaN(usdValue)) return 0
    return usdValue * (rates[currency] ?? 1)
  }

  const symbols = { USD: '$', EUR: '€' }
  const symbol = symbols[currency] ?? '$'

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, rates, fromUSD, symbol }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export const useCurrency = () => useContext(CurrencyContext)
