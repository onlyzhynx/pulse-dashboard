import { Router } from 'express'
import fetch from 'node-fetch'
import { requireAuth } from '../middleware/auth.js'

let cached = null
let cacheTime = 0

// EUR per 1 USD. Only used until the first successful rate fetch.
const FALLBACK_EUR = 0.92

export default function currencyRouter(db) {
  const router = Router()
  router.use(requireAuth)

  router.get('/rates', async (req, res) => {
    const now = Date.now()
    if (cached && now - cacheTime < 3_600_000) return res.json(cached)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR', { signal: controller.signal })
      clearTimeout(timeout)
      const d = await r.json()
      cached = { rates: { USD: 1, EUR: d.rates.EUR }, date: d.date }
      cacheTime = now

      // Persist so the net-worth calc can convert EUR balances without a fetch
      try {
        db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('usd_eur_rate', ?)")
          .run(String(d.rates.EUR))
      } catch (e) { /* ignore */ }

      res.json(cached)
    } catch {
      res.json(cached ?? { rates: { USD: 1, EUR: FALLBACK_EUR }, date: null, fallback: true })
    }
  })

  return router
}
