import { Router } from 'express'
import fetch from 'node-fetch'
import { requireAuth } from '../middleware/auth.js'
import { quoteAllowed } from '../services/dexScreenerApi.js'

export default function holdingsRouter(db) {
  const router = Router()
  router.use(requireAuth)

  // ── Blacklist helpers (stored in app_settings as JSON) ────────────────
  function getBlacklist() {
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'holdings_blacklist'").get()
      return new Set(JSON.parse(row?.value || '[]'))
    } catch { return new Set() }
  }
  function saveBlacklist(set) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('holdings_blacklist', ?)")
      .run(JSON.stringify([...set]))
  }

  // ── Watchlist helpers (tokens to always track / pin, never hidden as dust) ─
  function getWatchlist() {
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'holdings_watchlist'").get()
      return new Set(JSON.parse(row?.value || '[]'))
    } catch { return new Set() }
  }
  function saveWatchlist(set) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('holdings_watchlist', ?)")
      .run(JSON.stringify([...set]))
  }

  // ── Holdings snapshot ─────────────────────────────────────────────────
  // Aggregates across wallets: same token held in multiple wallets sums correctly.
  // token_key = "chain_addr" (e.g. "solana_epjf...") — used as the stable ID for blacklisting.
  function getOverrides() {
    const m = new Map()
    try { for (const r of db.prepare('SELECT token_key, symbol, name FROM token_overrides').all()) m.set(r.token_key, r) } catch {}
    return m
  }

  router.get('/snapshot', (req, res) => {
    const blacklist = getBlacklist()
    const watchlist = getWatchlist()
    const overrides = getOverrides()
    const items = db.prepare(`
      SELECT
        COALESCE(hu.token_key, hu.id)                       AS id,
        MAX(hu.symbol)                                       AS symbol,
        MAX(hu.name)                                         AS name,
        MAX(hu.network)                                      AS network,
        MAX(hu.address)                                      AS address,
        SUM(hu.holdings_units)                               AS holdings_units,
        MAX(hu.price_usd)                                    AS price_usd,
        SUM(hu.holdings_units * COALESCE(hu.price_usd, 0))  AS value_usd,
        MAX(fs.first_seen)                                   AS first_seen
      FROM holdings_universe hu
      LEFT JOIN token_first_seen fs ON fs.token_key = COALESCE(hu.token_key, hu.id)
      LEFT JOIN wallets w ON w.id = hu.wallet_id
      -- Only count holdings from existing, enabled wallets (matches net worth,
      -- which sums enabled wallets). Manual imports have no wallet_id and stay.
      -- Excludes orphan rows left behind by deleted/disabled wallets.
      WHERE hu.wallet_id IS NULL OR w.enabled = 1
      GROUP BY COALESCE(hu.token_key, hu.id)
      ORDER BY SUM(hu.holdings_units * COALESCE(hu.price_usd, 0)) DESC
    `).all()

    // A token is "watched" if its id (token_key), contract address, or symbol
    // is on the watchlist — so you can pin by symbol/address before you hold it.
    const watchMatch = (h) =>
      watchlist.has(h.id) ||
      (h.address && watchlist.has(String(h.address).toLowerCase())) ||
      (h.symbol && watchlist.has(String(h.symbol).toLowerCase()))

    const holdings = items.map(h => {
      const ov = overrides.get(h.id)
      return {
        ...h,
        symbol: ov?.symbol || h.symbol,
        name: ov?.name || h.name,
        renamed: ov ? 1 : 0,
        blacklisted: blacklist.has(h.id) ? 1 : 0,
        watched: watchMatch(h) ? 1 : 0,
        first_seen: h.first_seen || null,
      }
    })
    res.json({ holdings })
  })

  // ── Manual ticker/name override ───────────────────────────────────────
  router.post('/override', (req, res) => {
    const { id, symbol, name } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const sym = (symbol || '').trim() || null
    const nm  = (name || '').trim() || null
    if (!sym && !nm) {
      db.prepare('DELETE FROM token_overrides WHERE token_key = ?').run(id)
      return res.json({ ok: true, cleared: true })
    }
    db.prepare(`
      INSERT INTO token_overrides (token_key, symbol, name) VALUES (?, ?, ?)
      ON CONFLICT(token_key) DO UPDATE SET symbol = excluded.symbol, name = excluded.name
    `).run(id, sym, nm)
    res.json({ ok: true })
  })

  router.delete('/override/:id', (req, res) => {
    db.prepare('DELETE FROM token_overrides WHERE token_key = ?').run(decodeURIComponent(req.params.id))
    res.json({ ok: true })
  })

  router.get('/universe', (req, res) => {
    const items = db.prepare('SELECT * FROM holdings_universe ORDER BY symbol').all()
    res.json({ items })
  })

  // ── Live token market info (hover cards) ──────────────────────────────
  // GET /token-info/:id where id = token_key ("chain_addr"). Pulls price,
  // market cap, liquidity, volume and 24h change from DexScreener (free, covers
  // Solana + EVM by bare address). Cached 2 min server-side so hovering around
  // the list doesn't hammer the API.
  const DEX_CHAIN = { solana: 'solana', ethereum: 'ethereum', base: 'base', bnb: 'bsc', bsc: 'bsc', robinhood: 'robinhood' }
  const _tokenInfoCache = new Map() // token_key -> { data, ts }
  const TOKEN_INFO_TTL_MS = 120_000
  const numOrNull = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null }

  router.get('/token-info/:id', async (req, res) => {
    const id = decodeURIComponent(req.params.id)
    const cached = _tokenInfoCache.get(id)
    if (cached && Date.now() - cached.ts < TOKEN_INFO_TTL_MS) return res.json(cached.data)

    const sep = id.indexOf('_')
    const chain = sep > 0 ? id.slice(0, sep).toLowerCase() : ''
    const addr = sep > 0 ? id.slice(sep + 1) : ''
    if (!addr || addr === 'native') {
      // Native gas tokens have no contract to look up — the row's own price is
      // all we have. (Native SOL is stored under the wSOL mint, so it resolves.)
      const data = { found: false, reason: 'native' }
      _tokenInfoCache.set(id, { data, ts: Date.now() })
      return res.json(data)
    }

    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, {
        signal: ctrl.signal, headers: { accept: 'application/json' },
      })
      clearTimeout(t)
      const body = resp.ok ? await resp.json() : null

      // Highest-liquidity pair wins (most reliable numbers). Prefer pairs on
      // the token's own chain; fall back to any chain if none match.
      const pick = (requireChain) => {
        let best = null
        for (const p of body?.pairs || []) {
          if ((p?.baseToken?.address || '').toLowerCase() !== addr.toLowerCase()) continue
          if (requireChain && p.chainId !== DEX_CHAIN[chain]) continue
          if (!quoteAllowed(p)) continue  // junk quote token — its USD liquidity is fiction
          const liq = parseFloat(p?.liquidity?.usd) || 0
          if (!best || liq > best._liq) best = { ...p, _liq: liq }
        }
        return best
      }
      const best = pick(Boolean(DEX_CHAIN[chain])) || pick(false)

      const data = best ? {
        found: true,
        symbol: best.baseToken?.symbol || null,
        chain: best.chainId,
        price: numOrNull(best.priceUsd),
        marketCap: numOrNull(best.marketCap),
        fdv: numOrNull(best.fdv),
        liquidity: best._liq,
        volume24h: numOrNull(best.volume?.h24),
        change24h: numOrNull(best.priceChange?.h24),
        pairUrl: best.url || null,
      } : { found: false }

      // DexScreener omits marketCap/fdv on major tokens (e.g. wSOL) — fill the
      // gap from GeckoTerminal. Note its network id for Ethereum is 'eth'.
      if (data.found && !data.marketCap && !data.fdv) {
        const GECKO_NET = { solana: 'solana', ethereum: 'eth', base: 'base', bnb: 'bsc', bsc: 'bsc' }
        const net = GECKO_NET[chain]
        if (net) {
          try {
            const { findTokenByAddress } = await import('../services/geckoTerminalApi.js')
            const g = await findTokenByAddress(addr, net)
            if (g) {
              data.marketCap = numOrNull(g.market_cap_usd)
              data.fdv = data.fdv || numOrNull(g.fdv_usd)
              if (!data.price) data.price = numOrNull(g.price_usd)
            }
          } catch { /* mcap stays null — card just omits the row */ }
        }
      }

      _tokenInfoCache.set(id, { data, ts: Date.now() })
      res.json(data)
    } catch (e) {
      res.json({ found: false, error: e.message })  // hover card degrades gracefully
    }
  })

  // ── Blacklist CRUD ────────────────────────────────────────────────────
  router.get('/blacklist', (req, res) => {
    res.json({ ids: [...getBlacklist()] })
  })

  router.post('/blacklist', (req, res) => {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const bl = getBlacklist()
    bl.add(id)
    saveBlacklist(bl)
    res.json({ ok: true })
  })

  router.delete('/blacklist/:id', (req, res) => {
    const bl = getBlacklist()
    bl.delete(decodeURIComponent(req.params.id))
    saveBlacklist(bl)
    res.json({ ok: true })
  })

  // ── Watchlist CRUD ────────────────────────────────────────────────────
  router.get('/watchlist', (req, res) => {
    res.json({ ids: [...getWatchlist()] })
  })

  router.post('/watchlist', (req, res) => {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const wl = getWatchlist()
    wl.add(id)
    saveWatchlist(wl)
    res.json({ ok: true })
  })

  router.delete('/watchlist/:id', (req, res) => {
    const wl = getWatchlist()
    wl.delete(decodeURIComponent(req.params.id))
    saveWatchlist(wl)
    res.json({ ok: true })
  })

  return router
}
