import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { fetchHyperliquidState } from '../services/hyperliquidApi.js'

export default function hyperliquidRouter(db) {
  const router = Router()
  router.use(requireAuth)

  // Live positions for every wallet stored with network = 'Hyperliquid'
  router.get('/', async (req, res) => {
    const wallets = db.prepare(
      "SELECT id, label, address FROM wallets WHERE network = 'Hyperliquid' AND enabled = 1"
    ).all()

    const accounts = await Promise.all(wallets.map(async (w) => {
      try {
        const st = await fetchHyperliquidState(w.address)
        return { id: w.id, label: w.label || w.address.slice(0, 6), address: w.address, ok: true, ...st }
      } catch (e) {
        return { id: w.id, label: w.label, address: w.address, ok: false, error: e.message }
      }
    }))

    res.json({
      accounts,
      totalValue:    accounts.reduce((s, a) => s + (a.totalValue || 0), 0),
      unrealizedPnl: accounts.reduce((s, a) => s + (a.unrealizedPnl || 0), 0),
    })
  })

  return router
}
