// Normalized, read-only portfolio state for the agent connector (routes/connector.js).
//
// Everything here is derived from the SAME tables and helpers the dashboard uses
// — net worth comes from computeCryptoUsd/computeBankUsd (portfolioSnapshot.js),
// per-token holdings from holdings_universe aggregated exactly like the Holdings
// list (routes/holdings.js) — so the agent can never see a different number than
// the UI. No external calls, no writes: pure DB reads.

import { computeCryptoUsd, computeBankUsd } from './portfolioSnapshot.js'

// ── Heuristic asset classes ──────────────────────────────────────────────────
// Pulse doesn't tag tokens, so "liquid vs illiquid" is inferred from the symbol.
// stable  = dollar stablecoins
// liquid  = bluechips you can exit instantly without moving price (the core bags)
// illiquid = everything else (alts, microcaps, LP/perp pseudo-tokens, unnamed)
const STABLES = new Set([
  'USDC', 'USDT', 'DAI', 'USDE', 'SUSDE', 'USDS', 'SUSDS', 'FDUSD', 'TUSD', 'BUSD',
  'PYUSD', 'USD1', 'USDC.E', 'USDBC', 'CRVUSD', 'GHO', 'FRAX', 'LUSD', 'USDD', 'USDY',
])
const BLUECHIP = new Set([
  'BTC', 'WBTC', 'CBBTC', 'TBTC',
  'ETH', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'RETH', 'EZETH',
  'SOL', 'MSOL', 'JITOSOL', 'JUPSOL', 'BSOL', 'JSOL',
  'BNB', 'WBNB',
])

function classOf(symbol) {
  const s = (symbol || '').toUpperCase()
  if (STABLES.has(s)) return 'stable'
  if (BLUECHIP.has(s)) return 'liquid'
  return 'illiquid'
}

// ── small helpers ─────────────────────────────────────────────────────────────
function round(n, d = 2) {
  if (!Number.isFinite(n)) return 0
  const f = 10 ** d
  return Math.round(n * f) / f
}

// token_key is "<chain>_<addr>" (e.g. "solana_epjf…", "base_native"). The chain is
// the canonical source of truth for which network a holding lives on — a single
// "EVM" wallet can hold tokens on ethereum/base/bnb at once.
function chainOf(tokenKey, network) {
  if (tokenKey && tokenKey.includes('_')) return tokenKey.slice(0, tokenKey.indexOf('_'))
  return (network || '').toLowerCase()
}

function getBlacklist(db) {
  try {
    return new Set(JSON.parse(
      db.prepare("SELECT value FROM app_settings WHERE key = 'holdings_blacklist'").get()?.value || '[]'
    ))
  } catch { return new Set() }
}

function rate(db, key, def) {
  const v = parseFloat(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value)
  return Number.isFinite(v) ? v : def
}

function walletName(label, address) {
  return label || (address ? address.slice(0, 8) : 'wallet')
}

// ── assets (aggregated per token across all enabled wallets + manual imports) ──
// Mirrors routes/holdings.js GET /snapshot: groups by token_key, only counts rows
// from enabled wallets (or manual imports with no wallet_id), so orphan rows from
// deleted/disabled wallets are excluded — matching net worth.
export function getAssetsState(db) {
  const bl = getBlacklist(db)
  const items = db.prepare(`
    SELECT
      COALESCE(hu.token_key, hu.id)                      AS token_key,
      MAX(hu.symbol)                                      AS symbol,
      MAX(hu.name)                                        AS name,
      MAX(hu.network)                                     AS network,
      MAX(hu.address)                                     AS address,
      SUM(hu.holdings_units)                              AS amount,
      MAX(hu.price_usd)                                   AS price_usd,
      SUM(hu.holdings_units * COALESCE(hu.price_usd, 0))  AS value_usd,
      COUNT(DISTINCT hu.wallet_id)                        AS wallet_count
    FROM holdings_universe hu
    LEFT JOIN wallets w ON w.id = hu.wallet_id
    WHERE hu.wallet_id IS NULL OR w.enabled = 1
    GROUP BY COALESCE(hu.token_key, hu.id)
    ORDER BY value_usd DESC
  `).all()

  return items.map(i => ({
    symbol: i.symbol || null,
    name: i.name || null,
    chain: chainOf(i.token_key, i.network),
    contract: i.address || null,        // mint (Solana) or contract (EVM); '' / null for native
    amount: i.amount || 0,
    price_usd: i.price_usd ?? null,
    value_usd: round(i.value_usd),
    token_key: i.token_key,
    wallet_count: i.wallet_count,
    class: classOf(i.symbol),
    blacklisted: bl.has(i.token_key) ? 1 : 0,
    // Pulse doesn't persist which pricing source/liquidity backed a token, so these
    // are surfaced as nulls rather than guessed.
    price_source: null,
    liquidity_usd: null,
  }))
}

// ── wallets (each enabled wallet + its per-token assets and chain breakdown) ───
export function getWalletsState(db) {
  const bl = getBlacklist(db)
  const wallets = db.prepare('SELECT * FROM wallets WHERE enabled = 1 ORDER BY position').all()

  const byWallet = {}
  for (const r of db.prepare('SELECT * FROM holdings_universe WHERE wallet_id IS NOT NULL').all()) {
    (byWallet[r.wallet_id] ||= []).push(r)
  }

  return wallets.map(w => {
    const assets = (byWallet[w.id] || [])
      .map(r => {
        const id = r.token_key || r.id
        const value = (r.holdings_units || 0) * (r.price_usd || 0)
        return {
          symbol: r.symbol || null,
          name: r.name || null,
          chain: chainOf(r.token_key, r.network),
          contract: r.address || null,
          amount: r.holdings_units || 0,
          price_usd: r.price_usd ?? null,
          value_usd: round(value),
          token_key: id,
          class: classOf(r.symbol),
          blacklisted: bl.has(id) ? 1 : 0,
        }
      })
      .sort((a, b) => b.value_usd - a.value_usd)

    const chainMap = {}
    for (const a of assets) {
      if (a.blacklisted) continue
      chainMap[a.chain] = (chainMap[a.chain] || 0) + a.value_usd
    }

    let tags = []
    try { tags = JSON.parse(w.tags || '[]') } catch {}

    return {
      id: w.id,
      name: walletName(w.label, w.address),
      address: w.address,
      network: w.network,                 // wallet's declared network (Solana / EVM / Hyperliquid / …)
      value_usd: round(w.total_usd),       // already blacklist-excluded at persist time
      token_count: w.token_count,
      last_refreshed: w.last_refreshed,
      tags,
      side: !!w.side,
      chains: Object.entries(chainMap)
        .map(([chain, v]) => ({ chain, value_usd: round(v) }))
        .sort((a, b) => b.value_usd - a.value_usd),
      assets,
    }
  })
}

// ── summary (net worth, liquid split, deltas, currency breakdown) ─────────────
function baselineDelta(db, current, n, unit) {
  const base =
    db.prepare(`SELECT value FROM portfolio_snapshots WHERE captured_at <= datetime('now','-${n} ${unit}') ORDER BY captured_at DESC LIMIT 1`).get() ||
    db.prepare('SELECT value FROM portfolio_snapshots ORDER BY captured_at ASC LIMIT 1').get()
  const prev = base?.value ?? current
  const delta = current - prev
  return { delta: round(delta), pct: prev > 0 ? round((delta / prev) * 100, 2) : 0 }
}

export function getSummaryState(db) {
  const crypto_usd = computeCryptoUsd(db)
  const bank_usd = computeBankUsd(db)
  const net = crypto_usd + bank_usd

  const eurRate = rate(db, 'usd_eur_rate', 0.92)
  const bank_eur = db.prepare("SELECT COALESCE(SUM(balance), 0) AS t FROM bank_accounts WHERE currency = 'EUR'").get().t

  const latest = db.prepare('SELECT value, captured_at FROM portfolio_snapshots ORDER BY captured_at DESC LIMIT 1').get()
  const d1 = baselineDelta(db, net, 20, 'hours')   // ~24h, matches /api/networth window
  const d7 = baselineDelta(db, net, 6, 'days')

  // Liquid split from per-token rows (value-only wallets have no token rows, so
  // their value is treated as illiquid since we can't see what's inside).
  const assets = getAssetsState(db).filter(a => !a.blacklisted)
  const bucket = { stable: 0, liquid: 0, illiquid: 0 }
  for (const a of assets) bucket[a.class] += a.value_usd
  const tokenTotal = bucket.stable + bucket.liquid + bucket.illiquid
  const valueOnly = Math.max(0, crypto_usd - tokenTotal)

  return {
    updated_at: latest?.captured_at || new Date().toISOString(),
    net_worth_usd: round(net),
    crypto_usd: round(crypto_usd),
    bank_usd: round(bank_usd),
    bank_eur: round(bank_eur),
    // "can I afford this without selling core bags" = stables + bluechips
    liquid_usd: round(bucket.stable + bucket.liquid),
    stable_usd: round(bucket.stable),
    illiquid_usd: round(bucket.illiquid + valueOnly),
    delta_24h_usd: d1.delta,
    delta_24h_pct: d1.pct,
    delta_7d_usd: d7.delta,
    delta_7d_pct: d7.pct,
    currency: { USD: round(net), EUR: round(net * eurRate) },
    rates: { USD: 1, EUR: eurRate },
  }
}

// ── exposure (% by token / chain / wallet / class) ────────────────────────────
export function getExposureState(db) {
  const crypto = computeCryptoUsd(db)
  const denom = crypto || 1
  const assets = getAssetsState(db).filter(a => !a.blacklisted && a.value_usd > 0)
  const tokenTotal = assets.reduce((s, a) => s + a.value_usd, 0)
  const valueOnly = Math.max(0, crypto - tokenTotal)

  const by_token = assets
    .map(a => ({
      symbol: a.symbol,
      chain: a.chain,
      token_key: a.token_key,
      value_usd: a.value_usd,
      pct: round((a.value_usd / denom) * 100, 2),
    }))
    .sort((a, b) => b.value_usd - a.value_usd)

  const chainMap = {}
  for (const a of assets) chainMap[a.chain] = (chainMap[a.chain] || 0) + a.value_usd
  // value-only wallets (no per-token rows) contribute to their declared network
  for (const w of db.prepare(`
    SELECT network, total_usd FROM wallets w
    WHERE enabled = 1 AND NOT EXISTS (SELECT 1 FROM holdings_universe hu WHERE hu.wallet_id = w.id)
  `).all()) {
    const c = (w.network || '').toLowerCase()
    chainMap[c] = (chainMap[c] || 0) + (w.total_usd || 0)
  }
  const by_chain = Object.entries(chainMap)
    .map(([chain, v]) => ({ chain, value_usd: round(v), pct: round((v / denom) * 100, 2) }))
    .sort((a, b) => b.value_usd - a.value_usd)

  const by_wallet = db.prepare('SELECT label, address, total_usd FROM wallets WHERE enabled = 1').all()
    .map(w => ({
      name: walletName(w.label, w.address),
      value_usd: round(w.total_usd),
      pct: round(((w.total_usd || 0) / denom) * 100, 2),
    }))
    .sort((a, b) => b.value_usd - a.value_usd)

  const cls = { stable: 0, liquid: 0, illiquid: 0 }
  for (const a of assets) cls[a.class] += a.value_usd
  cls.illiquid += valueOnly
  const mk = (v) => ({ value_usd: round(v), pct: round((v / denom) * 100, 2) })

  return {
    basis_usd: round(crypto),   // denominator = crypto net worth (excludes bank + blacklist)
    by_token,
    by_chain,
    by_wallet,
    by_class: { stable: mk(cls.stable), liquid: mk(cls.liquid), illiquid: mk(cls.illiquid) },
  }
}

// ── positions (lookup a token by symbol / contract / mint, with wallet locations) ──
export function findPositions(db, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return { query, matches: [] }
  const bl = getBlacklist(db)

  const rows = db.prepare(`
    SELECT hu.*, w.label AS wallet_label, w.address AS wallet_address
    FROM holdings_universe hu
    LEFT JOIN wallets w ON w.id = hu.wallet_id
    WHERE hu.wallet_id IS NULL OR w.enabled = 1
  `).all()

  const matched = rows.filter(r => {
    const sym = (r.symbol || '').toLowerCase()
    const addr = (r.address || '').toLowerCase()
    const tk = (r.token_key || r.id || '').toLowerCase()
    return (
      sym === q ||
      addr === q ||
      tk === q ||
      tk.endsWith('_' + q) ||                       // exact contract after the chain prefix
      (q.length >= 2 && sym.includes(q))            // fuzzy symbol match
    )
  })

  const groups = {}
  for (const r of matched) {
    const key = r.token_key || r.id
    const g = (groups[key] ||= {
      token_key: key,
      symbol: r.symbol || null,
      name: r.name || null,
      chain: chainOf(r.token_key, r.network),
      contract: r.address || null,
      price_usd: r.price_usd ?? null,
      amount: 0,
      value_usd: 0,
      blacklisted: bl.has(key) ? 1 : 0,
      // Pulse tracks no spot cost basis, so realized/unrealized PnL is unavailable.
      cost_basis_usd: null,
      unrealized_pnl_usd: null,
      locations: [],
    })
    const v = (r.holdings_units || 0) * (r.price_usd || 0)
    g.amount += r.holdings_units || 0
    g.value_usd += v
    if (g.price_usd == null) g.price_usd = r.price_usd ?? null
    g.locations.push({
      wallet: r.wallet_id ? walletName(r.wallet_label, r.wallet_address) : 'manual',
      wallet_id: r.wallet_id || null,
      amount: r.holdings_units || 0,
      value_usd: round(v),
    })
  }

  const matches = Object.values(groups)
    .map(g => ({ ...g, value_usd: round(g.value_usd) }))
    .sort((a, b) => b.value_usd - a.value_usd)

  return { query, matches }
}

// ── history (net-worth snapshots over a range, plus drawdown/PnL stats) ────────
const RANGE_DAYS = {
  '7d': 7, '14d': 14, '30d': 30, '90d': 90, '180d': 180, '365d': 365, '1y': 365, 'all': 99999,
}

function maxDrawdown(vals) {
  let peak = -Infinity
  let mdd = 0
  for (const v of vals) {
    if (v > peak) peak = v
    if (peak > 0) mdd = Math.min(mdd, (v - peak) / peak)
  }
  return mdd * 100
}

export function getHistory(db, range) {
  const key = (range || '30d').toLowerCase()
  const days = RANGE_DAYS[key] ?? 30
  const snapshots = db.prepare(`
    SELECT captured_at, value FROM portfolio_snapshots
    WHERE captured_at >= datetime('now', '-${days} days')
    ORDER BY captured_at ASC
  `).all()

  const vals = snapshots.map(s => s.value)
  const stats = vals.length ? {
    first: round(vals[0]),
    last: round(vals[vals.length - 1]),
    min: round(Math.min(...vals)),
    max: round(Math.max(...vals)),
    change_usd: round(vals[vals.length - 1] - vals[0]),
    change_pct: vals[0] > 0 ? round(((vals[vals.length - 1] - vals[0]) / vals[0]) * 100, 2) : 0,
    max_drawdown_pct: round(maxDrawdown(vals), 2),
    points: vals.length,
  } : null

  return {
    range: key,
    days: days === 99999 ? 'all' : days,
    snapshots: snapshots.map(s => ({ captured_at: s.captured_at, value_usd: round(s.value) })),
    stats,
  }
}

// ── one-shot blob (everything in a single call for the agent) ─────────────────
export function getFullState(db) {
  const summary = getSummaryState(db)
  return {
    updated_at: summary.updated_at,
    net_worth_usd: summary.net_worth_usd,
    summary,
    wallets: getWalletsState(db),
    assets: getAssetsState(db),
  }
}
