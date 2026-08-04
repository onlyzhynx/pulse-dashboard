import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { snapshotNetWorth } from '../services/portfolioSnapshot.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// Delay between wallets when refreshing, so shared RPC/price endpoints don't
// rate-limit us (was failing some wallets). Tune via WALLET_REFRESH_GAP_MS.
const REFRESH_GAP_MS = parseInt(process.env.WALLET_REFRESH_GAP_MS || '5000', 10)

// Tracks consecutive suspect-drop refreshes per wallet. A one-off collapse is
// rejected (transient glitch), but if the low value repeats it's accepted as a
// real drop so a genuine sell-off isn't ignored forever.
const suspectStreak = new Map()

export default function walletsRouter(db) {
  const router = Router()
  router.use(requireAuth)

  // Diagnostic: holdings left behind by deleted/disabled wallets. The /snapshot
  // query already excludes these from the list + totals; this endpoint just
  // reports them (with their wallet address) so deletions can be recovered.
  router.get('/orphans', (req, res) => {
    const orphans = db.prepare(`
      SELECT hu.wallet_id,
             COUNT(*)                                          AS rows,
             SUM(hu.holdings_units * COALESCE(hu.price_usd,0)) AS value_usd,
             CASE WHEN w.id IS NULL THEN 'deleted'
                  WHEN w.enabled = 0 THEN 'disabled' END       AS state
      FROM holdings_universe hu
      LEFT JOIN wallets w ON w.id = hu.wallet_id
      WHERE hu.wallet_id IS NOT NULL AND (w.id IS NULL OR w.enabled = 0)
      GROUP BY hu.wallet_id
      ORDER BY value_usd DESC
    `).all()
    res.json({ orphans, totalValue: orphans.reduce((s, o) => s + (o.value_usd || 0), 0) })
  })

  // EVM has no token auto-discovery, so we fetch balances for the user's tracked
  // contract addresses (from the holdings watchlist). Any 0x… added via Holdings
  // "TRACK" gets fetched + counted across all EVM chains.
  function getWatchlistEvmAddresses() {
    try {
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'holdings_watchlist'").get()
      return JSON.parse(row?.value || '[]').filter(x => /^0x[0-9a-fA-F]{40}$/.test(x))
    } catch { return [] }
  }

  router.get('/snapshot', (req, res) => {
    const wallets = db.prepare('SELECT * FROM wallets WHERE enabled = 1 ORDER BY position').all()
    res.json({ wallets })
  })

  router.post('/', (req, res) => {
    const { label, address, network } = req.body
    if (!address || !network) return res.status(400).json({ error: 'address and network required' })
    const id = address.toLowerCase()
    db.prepare(`
      INSERT OR REPLACE INTO wallets (id, label, address, network) VALUES (?, ?, ?, ?)
    `).run(id, label || address.slice(0, 8), address, network)
    res.json({ ok: true, id })
  })

  // ── Shared: fetch blockchain data for one wallet ──────────────────────
  async function fetchWalletData(wallet) {
    const heliusKey    = process.env.HELIUS_API_KEY || null
    const heliusRpcUrl = heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : null
    const jupiterKey   = process.env.JUPITER_API_KEY || null

    if (wallet.network === 'Solana') {
      const { fetchSolanaWalletValue } = await import('../services/solanaWallet.js')
      const data = await fetchSolanaWalletValue(wallet.address, heliusKey, heliusRpcUrl, { jupiterApiKey: jupiterKey })
      // Meteora LP positions (DLMM + DAMM v2) aren't SPL tokens, so the account
      // scan can't see them — append them as pseudo-holdings so they count.
      try {
        const { fetchMeteoraPositions, toHoldingTokens } = await import('../services/meteoraApi.js')
        const lps = await fetchMeteoraPositions(wallet.address)
        if (lps.length) {
          data.tokens = [...(data.tokens || []), ...toHoldingTokens(lps)]
          data.totalValue = (data.totalValue || 0) + lps.reduce((s, p) => s + p.valueUsd, 0)
          console.log(`[meteora] ${wallet.label || wallet.id}: ${lps.length} LP position(s), $${lps.reduce((s, p) => s + p.valueUsd, 0).toFixed(0)}`)
        }
      } catch (e) { console.warn('[meteora]', wallet.id, e.message) }
      return data
    }

    if (wallet.network === 'EVM') {
      // Generic "EVM" = scan Ethereum + Base + BNB + Robinhood Chain in parallel.
      // Pass the tracked ERC-20 addresses so they're fetched + valued on each chain.
      const { fetchAllEVMChainsValue } = await import('../services/evmWallet.js')
      const tracked = getWatchlistEvmAddresses()
      const byChain = { ethereum: tracked, base: tracked, bnb: tracked, robinhood: tracked }
      return fetchAllEVMChainsValue(wallet.address, byChain)
    }

    if (wallet.network === 'Hyperliquid') {
      // A Hyperliquid account is just an EVM address, so it usually also holds
      // spot tokens on Ethereum/Base/BNB. Track BOTH: perps/HL-spot equity AND
      // on-chain EVM holdings. Perps equity is folded in as a pseudo-holding so
      // the wallet total (and thus net worth) includes it.
      const { fetchHyperliquidState } = await import('../services/hyperliquidApi.js')
      const { fetchAllEVMChainsValue } = await import('../services/evmWallet.js')
      const tracked = getWatchlistEvmAddresses()
      const [st, evm] = await Promise.all([
        fetchHyperliquidState(wallet.address).catch(e => { console.warn('[hl]', wallet.id, e.message); return { totalValue: 0 } }),
        fetchAllEVMChainsValue(wallet.address, { ethereum: tracked, base: tracked, bnb: tracked, robinhood: tracked })
          .catch(e => { console.warn('[hl-evm]', wallet.id, e.message); return { totalValue: 0, tokens: [] } }),
      ])
      const tokens = [...(evm.tokens || [])]
      if (st.totalValue > 0) {
        tokens.push({
          symbol: 'HL', name: 'Hyperliquid Perps', address: 'hyperliquid',
          chain: 'hyperliquid', chainDisplay: 'Hyperliquid',
          uiAmount: 1, price: st.totalValue, value: st.totalValue, tracked: true,
        })
      }
      return { totalValue: (evm.totalValue || 0) + (st.totalValue || 0), tokens }
    }

    // Specific chain (ethereum / base / bnb / etc.) — same auto-discovery + dust
    // pruning as the multi-chain path, plus the tracked watchlist addresses.
    const { fetchEVMChainValuePruned } = await import('../services/evmWallet.js')
    return fetchEVMChainValuePruned(wallet.address, wallet.network.toLowerCase(), getWatchlistEvmAddresses())
  }

  // ── Shared: persist fetched data to DB ───────────────────────────────
  // Returns { totalUsd, tokenCount, suspect }. `suspect: true` means the refresh
  // looked broken (a throttled RPC / unpriced tokens collapsing the value), so we
  // KEEP the previous value + holdings and callers must NOT snapshot net worth.
  function persistWalletData(wallet, data) {
    const tokenCount = data.tokens?.length ?? 0
    const prev = db.prepare('SELECT total_usd FROM wallets WHERE id = ?').get(wallet.id)?.total_usd || 0

    let blacklistIds = []
    try { blacklistIds = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'holdings_blacklist'").get()?.value || '[]') } catch {}
    const blSet = new Set(blacklistIds)

    const keyOf = (t) => `${t.chain || wallet.network.toLowerCase()}_${(t.mint || t.address || 'native').toLowerCase()}`

    // Last-known-price retention: a token that comes back unpriced this refresh
    // (rate-limited price API) keeps its previous price instead of cratering to
    // $0. This is the main defense against value swings — a transient pricing
    // failure on one big holding no longer wipes it out.
    //
    // EXCEPT tokens whose price was actively REJECTED by the liquidity sanity
    // check (scam pool / position dwarfs the pool): retaining would resurrect
    // the very bogus price we just refused, forever. Those stay at $0.
    if (tokenCount > 0) {
      const last = new Map(
        db.prepare('SELECT token_key, price_usd FROM holdings_universe WHERE wallet_id = ?')
          .all(wallet.id).map(r => [r.token_key, r.price_usd])
      )
      let retained = 0
      for (const t of data.tokens) {
        if (!(t.price > 0) && !t.priceRejected) {
          const lp = last.get(keyOf(t))
          if (lp > 0) { t.price = lp; retained++ }
        }
      }
      if (retained > 0) console.log(`[wallets] ${wallet.label || wallet.id}: kept last price for ${retained} unpriced token(s)`)
    }

    // Prospective total from the freshly FETCHED data (after retention), computed
    // BEFORE we mutate the DB — so a suspect result can be rejected without
    // destroying good rows.
    const fetchedTotal = (tokenCount === 0 && typeof data.totalValue === 'number')
      ? data.totalValue
      : (data.tokens || []).reduce((s, t) => blSet.has(keyOf(t)) ? s : s + (t.uiAmount ?? t.balance ?? 0) * (t.price ?? 0), 0)

    // Suspect-drop guard: $0, or a collapse to under RATIO of the previous value,
    // is almost always a throttled RPC / unpriced-token glitch — not a real change.
    // Reject a one-off collapse (keep previous value + holdings, flag so we don't
    // snapshot); accept it only if it repeats, so a real sell-off isn't stuck.
    const RATIO = Number(process.env.WALLET_SUSPECT_DROP_RATIO ?? 0.5)
    if (prev > 1 && fetchedTotal < prev * RATIO) {
      const streak = (suspectStreak.get(wallet.id) || 0) + 1
      suspectStreak.set(wallet.id, streak)
      if (streak < 2) {
        console.warn(`[wallets] ${wallet.label || wallet.id}: refresh $${fetchedTotal.toFixed(2)} << previous $${prev.toFixed(2)} — keeping previous (suspect #${streak})`)
        return { totalUsd: prev, tokenCount, suspect: true }
      }
      console.warn(`[wallets] ${wallet.label || wallet.id}: low value $${fetchedTotal.toFixed(2)} persisted ${streak}x — accepting as real`)
    }
    suspectStreak.delete(wallet.id)

    // Single-value source / empty wallet (no per-token holdings).
    if (tokenCount === 0) {
      db.prepare(`UPDATE wallets SET total_usd = ?, token_count = 0, last_refreshed = datetime('now') WHERE id = ?`)
        .run(fetchedTotal, wallet.id)
      return { totalUsd: fetchedTotal, tokenCount: 0, suspect: false }
    }

    // Replace this wallet's holdings with the fresh set (removed tokens disappear,
    // no double-counting).
    db.prepare('DELETE FROM holdings_universe WHERE wallet_id = ?').run(wallet.id)
    const insert = db.prepare(`
      INSERT INTO holdings_universe
        (id, token_key, wallet_id, symbol, name, network, address, holdings_units, price_usd, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        holdings_units = excluded.holdings_units,
        price_usd      = excluded.price_usd,
        last_updated   = excluded.last_updated,
        symbol = COALESCE(excluded.symbol, symbol),
        name   = COALESCE(excluded.name,   name)
    `)
    const markSeen = db.prepare("INSERT OR IGNORE INTO token_first_seen (token_key, first_seen) VALUES (?, datetime('now'))")
    db.transaction((tokens) => {
      for (const t of tokens) {
        const chain    = t.chain || wallet.network.toLowerCase()
        const addr     = (t.mint || t.address || 'native').toLowerCase()
        const tokenKey = `${chain}_${addr}`
        markSeen.run(tokenKey)
        // ID is wallet-scoped so the same token in two wallets gets two rows
        const id       = `${wallet.id}_${tokenKey}`
        const addrShort = (t.mint || t.address || '').slice(0, 6).toUpperCase()
        const symbol   = t.symbol || (addrShort ? addrShort : null)
        insert.run(
          id, tokenKey, wallet.id,
          symbol,
          t.name   || null,
          t.chainDisplay || wallet.network,
          t.mint   || t.address || '',
          t.uiAmount ?? t.balance ?? 0,
          t.price  ?? 0
        )
      }
    })(data.tokens)

    // Recompute the precise total from stored rows (excludes blacklisted tokens).
    let totalUsd
    try {
      if (blacklistIds.length > 0) {
        const placeholders = blacklistIds.map(() => '?').join(',')
        totalUsd = db.prepare(`
          SELECT COALESCE(SUM(holdings_units * COALESCE(price_usd, 0)), 0) AS t
          FROM holdings_universe
          WHERE wallet_id = ? AND (token_key IS NULL OR token_key NOT IN (${placeholders}))
        `).get(wallet.id, ...blacklistIds).t
      } else {
        totalUsd = db.prepare(`
          SELECT COALESCE(SUM(holdings_units * COALESCE(price_usd, 0)), 0) AS t
          FROM holdings_universe WHERE wallet_id = ?
        `).get(wallet.id).t
      }
    } catch { totalUsd = fetchedTotal }
    db.prepare(`UPDATE wallets SET total_usd = ?, token_count = ?, last_refreshed = datetime('now') WHERE id = ?`)
      .run(totalUsd, tokenCount, wallet.id)
    return { totalUsd, tokenCount, suspect: false }
  }

  // ── Refresh all wallets (shared executor) ────────────────────────────
  // One refresh-all at a time, process-wide: concurrent HTTP calls (multiple
  // open dashboard tabs/devices polling every 30 min) and the background
  // interval all JOIN the same in-flight run instead of each triggering a full
  // on-chain fetch. Silent (non-manual) requests are additionally throttled —
  // if a run completed recently the DB is fresh, so skip entirely.
  //
  // Within a run, wallets are grouped into provider lanes that fetch in
  // parallel: Solana (Helius/Jupiter) and EVM/Hyperliquid (public EVM RPCs/
  // Blockscout/HL) hit disjoint endpoints, so the anti-rate-limit gap only
  // matters BETWEEN wallets of the same lane, not across lanes. This roughly
  // halves the wall time of a mixed-portfolio refresh.
  const REFRESH_RECENT_MS = 20 * 60 * 1000
  let refreshInFlight = null
  let lastRefreshDone = 0

  async function runRefreshAll(manual) {
    const wallets = db.prepare('SELECT * FROM wallets WHERE enabled = 1').all()
    const results = []
    const lanes = [[], []]  // [solana, evm+hyperliquid]
    for (const w of wallets) (w.network === 'Solana' ? lanes[0] : lanes[1]).push(w)

    const runLane = async (list) => {
      for (let i = 0; i < list.length; i++) {
        const wallet = list[i]
        try {
          const data = await fetchWalletData(wallet)
          const { totalUsd, suspect } = persistWalletData(wallet, data)
          results.push({ id: wallet.id, ok: true, suspect: !!suspect, total_usd: totalUsd })
        } catch (e) {
          console.error(`Wallet refresh error [${wallet.id}]:`, e.message)
          results.push({ id: wallet.id, ok: false, error: e.message })
        }
        if (i < list.length - 1) await sleep(REFRESH_GAP_MS)  // breathe between same-lane wallets
      }
    }
    await Promise.all(lanes.map(runLane))

    // Only snapshot when EVERY wallet refreshed cleanly with a sane value — a
    // single failure or suspect-drop means the values can't be trusted, so we
    // skip the point rather than corrupt net worth + history. Force only on an
    // explicit manual refresh; background/silent runs use the 12h throttle.
    const clean = results.length > 0 && results.every(r => r.ok && !r.suspect)
    let snapshot = { skipped: clean ? 'ok-path' : 'unverified' }
    if (clean) snapshot = snapshotNetWorth(db, { force: manual })
    return { ok: true, clean, results, snapshot }
  }

  function refreshAllShared(manual) {
    // Join a run already in flight (a manual click during a silent run just
    // rides along — the values are seconds old either way).
    if (refreshInFlight) return refreshInFlight
    if (!manual && Date.now() - lastRefreshDone < REFRESH_RECENT_MS) {
      return Promise.resolve({ ok: true, skipped: 'recent', results: [], snapshot: { skipped: 'recent' } })
    }
    refreshInFlight = runRefreshAll(manual)
      .finally(() => { refreshInFlight = null; lastRefreshDone = Date.now() })
    return refreshInFlight
  }

  router.post('/refresh-all', async (req, res) => {
    const manual = req.query.manual === '1' || req.body?.manual === true
    try { res.json(await refreshAllShared(manual)) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ── Reorder wallets ───────────────────────────────────────────────────
  router.patch('/reorder', (req, res) => {
    const { order } = req.body
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' })
    const update = db.prepare('UPDATE wallets SET position = ? WHERE id = ?')
    db.transaction((ids) => { ids.forEach((id, i) => update.run(i, id)) })(order)
    res.json({ ok: true })
  })

  // ── Holdings for a single wallet ─────────────────────────────────────
  router.get('/:id/holdings', (req, res) => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(req.params.id)
    if (!wallet) return res.status(404).json({ error: 'not found' })
    const holdings = db.prepare(`
      SELECT * FROM holdings_universe
      WHERE wallet_id = ?
      ORDER BY (holdings_units * COALESCE(price_usd, 0)) DESC
    `).all(req.params.id)
    res.json({ wallet, holdings })
  })

  // ── Refresh single wallet ─────────────────────────────────────────────
  router.post('/:id/refresh', async (req, res) => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(req.params.id)
    if (!wallet) return res.status(404).json({ error: 'not found' })
    try {
      const data = await fetchWalletData(wallet)
      const { totalUsd, tokenCount, suspect } = persistWalletData(wallet, data)
      // No snapshot here: a single-wallet refresh can't verify the others, so it
      // must not write a net-worth point. Snapshots come from a full clean cycle.
      res.json({ ok: true, total_usd: totalUsd, token_count: tokenCount, suspect: !!suspect })
    } catch (e) {
      console.error('Wallet refresh error:', e.message)
      res.status(500).json({ error: e.message })
    }
  })

  // Update wallet metadata (label, side-folder flag)
  router.patch('/:id', (req, res) => {
    const { label, side } = req.body
    const fields = [], vals = []
    if (label !== undefined) { fields.push('label = ?'); vals.push(label) }
    if (side !== undefined)  { fields.push('side = ?');  vals.push(side ? 1 : 0) }
    if (!fields.length) return res.status(400).json({ error: 'nothing to update' })
    vals.push(req.params.id)
    db.prepare(`UPDATE wallets SET ${fields.join(', ')} WHERE id = ?`).run(...vals)
    res.json({ ok: true })
  })

  router.delete('/:id', (req, res) => {
    // Purge the wallet's holdings too, or they linger as orphan rows that inflate
    // the holdings list (which net worth, counting only live wallets, excludes).
    db.prepare('DELETE FROM holdings_universe WHERE wallet_id = ?').run(req.params.id)
    db.prepare('DELETE FROM wallets WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Background auto-refresh ───────────────────────────────────────────
  // Same shared executor as the HTTP route: it can never overlap a client-
  // triggered refresh, and it skips entirely when a dashboard poll already
  // refreshed recently. Snapshot rules live in runRefreshAll (clean-only,
  // 12h min-gap for non-manual). Default every 12h; 0 disables.
  const REFRESH_MIN = parseInt(process.env.WALLET_REFRESH_MINUTES || '720', 10)
  if (REFRESH_MIN > 0) {
    const tick = () => refreshAllShared(false).catch(e => console.error('[auto-refresh]', e.message))
    setTimeout(tick, 30_000)                  // shortly after boot
    setInterval(tick, REFRESH_MIN * 60_000)   // then on interval
    console.log(`[wallets] auto-refresh enabled: every ${REFRESH_MIN}m`)
  }

  return router
}
