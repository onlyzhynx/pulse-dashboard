import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { fetchMeteoraPositions } from '../services/meteoraApi.js'

export default function meteoraRouter(db) {
  const router = Router()
  router.use(requireAuth)

  // Live Meteora LP positions across every enabled Solana wallet
  router.get('/', async (req, res) => {
    const wallets = db.prepare(
      "SELECT id, label, address FROM wallets WHERE network = 'Solana' AND enabled = 1"
    ).all()

    const accounts = await Promise.all(wallets.map(async (w) => {
      try {
        const positions = await fetchMeteoraPositions(w.address)
        return {
          id: w.id,
          label: w.label || w.address.slice(0, 6),
          address: w.address,
          ok: true,
          positions,
          totalValue:   positions.reduce((s, p) => s + p.valueUsd, 0),
          unclaimedUsd: positions.reduce((s, p) => s + p.unclaimedUsd, 0),
          pnlUsd:       positions.reduce((s, p) => s + p.pnlUsd, 0),
        }
      } catch (e) {
        return { id: w.id, label: w.label, address: w.address, ok: false, error: e.message, positions: [] }
      }
    }))

    res.json({
      accounts,
      totalValue:   accounts.reduce((s, a) => s + (a.totalValue || 0), 0),
      unclaimedUsd: accounts.reduce((s, a) => s + (a.unclaimedUsd || 0), 0),
      pnlUsd:       accounts.reduce((s, a) => s + (a.pnlUsd || 0), 0),
    })
  })

  return router
}
