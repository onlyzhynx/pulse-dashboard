// Single source of truth for portfolio snapshots so every writer agrees on what
// "portfolio value" means (net worth = crypto wallets + bank, mirroring /api/networth).

// Crypto value = live holdings of enabled wallets, excluding blacklisted tokens
// (exactly once). Computed from holdings_universe — the SAME source as the
// Holdings list — so the home card and the Crypto tab can never disagree, and
// any stale/cratered wallet.total_usd can't skew net worth.
export function computeCryptoUsd(db) {
  let blIds = []
  try { blIds = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'holdings_blacklist'").get()?.value || '[]') } catch { /* ignore */ }
  const blFilter = blIds.length ? `AND COALESCE(hu.token_key, hu.id) NOT IN (${blIds.map(() => '?').join(',')})` : ''

  const holdings = db.prepare(`
    SELECT COALESCE(SUM(hu.holdings_units * COALESCE(hu.price_usd, 0)), 0) AS t
    FROM holdings_universe hu
    JOIN wallets w ON w.id = hu.wallet_id AND w.enabled = 1
    WHERE 1 = 1 ${blFilter}
  `).get(...blIds).t

  // Wallets whose value isn't broken into per-token rows (value-only sources).
  const valueOnly = db.prepare(`
    SELECT COALESCE(SUM(total_usd), 0) AS t FROM wallets w
    WHERE enabled = 1 AND NOT EXISTS (SELECT 1 FROM holdings_universe hu WHERE hu.wallet_id = w.id)
  `).get().t

  return holdings + valueOnly
}

export function computeBankUsd(db) {
  const usdEurRate = parseFloat(
    db.prepare("SELECT value FROM app_settings WHERE key = 'usd_eur_rate'").get()?.value || '0.92'
  )
  const banks = db.prepare('SELECT currency, balance FROM bank_accounts').all()
  return banks.reduce((s, a) => {
    if (a.currency === 'USD') return s + (a.balance || 0)
    if (a.currency === 'EUR') return s + (a.balance || 0) / usdEurRate
    return s
  }, 0)
}

export function computeNetWorthUsd(db) {
  return Math.max(0, computeCryptoUsd(db)) + computeBankUsd(db)
}

/**
 * Record one net-worth snapshot.
 *  - force: bypass the min-gap throttle (use for explicit "refresh all" / snapshot-now)
 *  - minGapHours: don't write if a snapshot already exists within this window
 * Returns { ok, value } or { skipped: reason }.
 */
export function snapshotNetWorth(db, { force = false, minGapHours = 11 } = {}) {
  const total = computeNetWorthUsd(db)
  if (!(total > 0)) return { skipped: 'zero' }
  if (!force) {
    const recent = db.prepare(
      `SELECT COUNT(*) AS c FROM portfolio_snapshots WHERE captured_at > datetime('now', '-${minGapHours} hours')`
    ).get().c
    if (recent > 0) return { skipped: 'throttled' }
  }
  db.prepare("INSERT INTO portfolio_snapshots (captured_at, value) VALUES (datetime('now'), ?)").run(total)
  return { ok: true, value: total }
}
