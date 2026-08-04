// One categorical palette, shared by every widget (previously duplicated in 6
// files, each drifting). Green is RESERVED for money-in / brand — so spending
// categories deliberately avoid green, letting the accent actually signal.
//
// Money-in family (green/teal) → Income, Salary, Cashout, Crypto Cashout.
// Everything else → distinct non-green hues.

export const CATEGORY_COLORS = {
  // ── Spending — non-green so the accent stays a signal ──
  Food:          '#f4a259',   // amber
  Transport:     '#5b9dff',   // blue
  Housing:       '#c084fc',   // violet
  Subscriptions: '#a78bfa',   // lavender
  Travel:        '#22d3ee',   // cyan
  Health:        '#f4708a',   // rose
  Shopping:      '#fb923c',   // orange
  Tech:          '#38bdf8',   // sky
  Gaming:        '#e879f9',   // fuchsia
  Hobbies:       '#fb923c',
  Bill:          '#fbbf24',   // gold
  Expense:       '#f4708a',
  Transfer:      '#94a3b8',   // neutral
  Investment:    '#818cf8',   // indigo
  Other:         '#8a938e',   // gray
  // ── Money-in — reserved green family ──
  Income:          '#3ecf8e',
  Salary:          '#35c9c0',   // teal (still "in", distinct from plain income)
  Trading:         '#5b9dff',   // an activity, not income → blue
  Cashout:         '#3ecf8e',
  'Crypto Cashout':'#3ecf8e',
}

// Cashout destinations (CashFlowWidget) — pure wayfinding, any distinct hues.
export const DEST_COLORS = {
  Coinbase: '#5b9dff',
  Kraken:   '#a78bfa',
  Binance:  '#fbbf24',
  Bank:     '#38bdf8',
  Wire:     '#22d3ee',
  Other:    '#8a938e',
}

// Chart series (pies etc.) — accent green leads, then a non-green rotation
// so slices never blur into one another or into a second green.
export const SERIES_COLORS = [
  '#3ecf8e', '#5b9dff', '#f4a259', '#a78bfa', '#22d3ee',
  '#f4708a', '#fb923c', '#e879f9', '#38bdf8', '#fbbf24',
]

export const catColor = (name) => CATEGORY_COLORS[name] ?? '#8a938e'
