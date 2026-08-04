import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import fetch from 'node-fetch'

export default function cryptoRouter(db) {
  const router = Router()
  router.use(requireAuth)

  router.get('/markets', async (req, res) => {
    try {
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${JSON.stringify(symbols)}`
      const data = await fetch(url).then(r => r.json())
      res.json({ markets: data })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.get('/majors', (req, res) => {
    const selection = db.prepare('SELECT symbol FROM major_selection').all().map(r => r.symbol)
    const tokens = db.prepare('SELECT * FROM major_tokens').all()
    res.json({ selection, tokens })
  })

  return router
}
