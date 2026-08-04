export const fmt = {
  currency(value, currency = 'USD') {
    if (value === null || value === undefined || isNaN(value)) return '—'
    const abs = Math.abs(value)
    const sign = value < 0 ? '-' : ''
    if (currency === 'EUR') return `${sign}€\u00a0${abs.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  },

  // Convenience: format a USD value in the active currency using CurrencyContext helpers
  // Usage: fmt.converted(usdValue, fromUSD, currency)
  converted(usdValue, fromUSD, currency) {
    return fmt.currency(fromUSD(usdValue), currency)
  },

  price(value) {
    if (value === null || value === undefined) return '—'
    if (value >= 1000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    if (value >= 1) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    return `$${value.toFixed(4)}`
  },

  percent(value) {
    if (value === null || value === undefined) return '—'
    return `${value.toFixed(2)}%`
  },

  number(value, decimals = 2) {
    if (value === null || value === undefined || isNaN(value)) return '—'
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  },

  compact(value, currency = 'USD') {
    if (!value) return '—'
    const sym = currency === 'EUR' ? '€\u00a0' : '$'
    if (value >= 1e9) return `${sym}${(value / 1e9).toFixed(1)}B`
    if (value >= 1e6) return `${sym}${(value / 1e6).toFixed(1)}M`
    if (value >= 1e3) return `${sym}${(value / 1e3).toFixed(0)}K`
    return `${sym}${value.toFixed(0)}`
  },

  shortDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  },

  fullDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
}
