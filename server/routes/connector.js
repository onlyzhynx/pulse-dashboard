import { Router } from 'express'
import { requireBearer } from '../middleware/bearerAuth.js'
import {
  getFullState,
  getSummaryState,
  getWalletsState,
  getAssetsState,
  getExposureState,
  findPositions,
  getHistory,
} from '../services/portfolioState.js'

// Read-only agent connector. Bearer-token only (no session), GET only — there is
// deliberately no write/refresh route here. Mounted at /api/v1/portfolio.
//
//   GET /api/v1/portfolio              one-shot blob (summary + wallets + assets)
//   GET /api/v1/portfolio/summary      net worth, liquid split, 24h/7d PnL, FX
//   GET /api/v1/portfolio/wallets      per-wallet value, chain breakdown, assets
//   GET /api/v1/portfolio/assets       every token: symbol, contract/mint, chain, amount, value
//   GET /api/v1/portfolio/exposure     % by token / chain / wallet / class
//   GET /api/v1/portfolio/positions/:q lookup by symbol or contract (wallet locations)
//   GET /api/v1/portfolio/history?range=30d   net-worth snapshots + drawdown/PnL
export default function connectorRouter(db) {
  const router = Router()
  router.use(requireBearer)

  // wrap so a DB hiccup returns JSON, not an HTML stack trace
  const h = (fn) => (req, res) => {
    try { res.json(fn(req)) }
    catch (e) { console.error('[connector]', e); res.status(500).json({ error: e.message }) }
  }

  router.get('/', h(() => getFullState(db)))
  router.get('/summary', h(() => getSummaryState(db)))
  router.get('/wallets', h(() => ({ wallets: getWalletsState(db) })))
  router.get('/assets', h(() => ({ assets: getAssetsState(db) })))
  router.get('/exposure', h(() => getExposureState(db)))
  router.get('/positions/:query', h((req) => findPositions(db, decodeURIComponent(req.params.query))))
  router.get('/history', h((req) => getHistory(db, req.query.range)))

  return router
}
