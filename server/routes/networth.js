import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { computeCryptoUsd, computeBankUsd } from '../services/portfolioSnapshot.js'

export default function networthRouter(db) {
  const router = Router()
  router.use(requireAuth)

  router.get('/', (req, res) => {
    // Crypto + bank from the shared net-worth calc, so the home card matches the
    // Crypto tab (same holdings source, blacklist excluded exactly once).
    const cryptoValue  = computeCryptoUsd(db)
    const bankValueUSD = computeBankUsd(db)
    const total_usd    = cryptoValue + bankValueUSD

    const bankTotalEUR = db.prepare(
      "SELECT COALESCE(SUM(balance), 0) AS t FROM bank_accounts WHERE currency = 'EUR'"
    ).get().t

    // 24h delta vs yesterday's snapshot (snapshots store net worth).
    const latestSnapshot = db.prepare(
      'SELECT value, captured_at FROM portfolio_snapshots ORDER BY captured_at DESC LIMIT 1'
    ).get()
    const yesterdaySnapshot = db.prepare(`
      SELECT value FROM portfolio_snapshots
      WHERE captured_at < datetime('now', '-20 hours')
      ORDER BY captured_at DESC LIMIT 1
    `).get()
    const prevNetWorth  = yesterdaySnapshot?.value ?? latestSnapshot?.value ?? total_usd
    const delta_24h     = total_usd - prevNetWorth
    const delta_24h_pct = prevNetWorth > 0 ? (delta_24h / prevNetWorth) * 100 : 0

    res.json({
      total_usd,
      crypto_usd:  cryptoValue,   // crypto only — frontend adds bank using live rate
      bank_usd:    bankValueUSD,
      bank_eur:    bankTotalEUR,
      delta_24h,
      delta_24h_pct,
      last_updated: latestSnapshot?.captured_at,
    })
  })

  return router
}
