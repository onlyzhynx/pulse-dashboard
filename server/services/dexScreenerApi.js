import fetch from 'node-fetch'

// DexScreener has the best free coverage for memecoins across Solana + EVM.
// Used as a last-resort price fallback for tokens Jupiter/GeckoTerminal miss.

// Short-lived price cache. A refresh-all cycle walks many wallets that share the
// same tokens (SOL, USDC, popular memecoins); caching dedupes those lookups so we
// don't hammer DexScreener and get rate-limited (which was zeroing out prices).
const _priceCache = new Map()                            // addr -> { price, symbol, name, _liq, ts }
const PRICE_TTL_MS = Number(process.env.DEXSCREENER_CACHE_MS ?? 120000)

// Scam/dust pools post fabricated prices behind a few dollars of "liquidity" —
// if such a pool is a token's ONLY pair, best-liquidity selection still picks
// it and an airdropped bag values at millions. Pairs below this floor can't
// price anything.
const MIN_LIQ_USD = Number(process.env.DEXSCREENER_MIN_LIQ_USD ?? 1000)

// A pair's reported USD liquidity is only as real as its QUOTE token — scam
// pairs quote against another worthless token and report fabricated USD
// liquidity that passes the floor. On Solana, only pools quoted in SOL or
// USDC are allowed to price anything. (Chains without an entry keep the
// floor + sanity checks only.)
export const TRUSTED_QUOTES = {
  solana: new Set([
    'so11111111111111111111111111111111111111112',  // wSOL
    'epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v',  // USDC
  ]),
}
export function quoteAllowed(pair) {
  const trusted = TRUSTED_QUOTES[pair?.chainId]
  if (!trusted) return true
  return trusted.has((pair?.quoteToken?.address || '').toLowerCase())
}

// Mints whose upstream prices are reliable AND which usually sit on the QUOTE
// side of pairs (a base-side DexScreener lookup may legitimately find nothing)
// — never second-guess these.
const VERIFY_EXEMPT = new Set([
  'so11111111111111111111111111111111111111112',  // wSOL
  'epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v',  // USDC
  'es9vmfrzacermjfrf4h2fyd4kcoNKy11mcce8benwnyb'.toLowerCase(),  // USDT
])

// Only positions worth at least this much get cross-verified (bounds the error
// small bags can introduce while keeping the check cheap).
const VERIFY_MIN_VALUE_USD = Number(process.env.PRICE_VERIFY_MIN_VALUE_USD ?? 1000)
// If the upstream price differs from the liquidity-verified price by more than
// this factor (either direction), the verified price wins.
const VERIFY_MAX_DEVIATION = Number(process.env.PRICE_VERIFY_MAX_DEVIATION ?? 3)

/**
 * Cross-check ALREADY-PRICED holdings whose implied value is significant
 * against liquidity-verified DexScreener pools (trusted quotes + liq floor).
 * Catches bogus prices from ANY upstream source — e.g. Jupiter pricing a
 * manipulated micro-pool at $20.68 while the token's only real pool trades at
 * $0.004 (the Jotchua case). Mutates rows:
 *  - wild deviation -> replaced with the verified price
 *  - value still dwarfs pool liquidity, or no trusted pool exists -> unpriced
 *    + priceRejected (so last-price retention won't resurrect the old number).
 */
export async function verifyPricesAgainstLiquidity(holdings = [], { skipMint } = {}) {
  const skip = (skipMint || '').toLowerCase()
  const keyOf = (h) => (h.mint || h.address || '').toLowerCase()
  const unitsOf = (h) => (h.uiAmount ?? h.balance ?? 0)
  const targets = holdings.filter(h => {
    const k = keyOf(h)
    return h && h.price > 0 && unitsOf(h) > 0 &&
      k && k !== 'native' && k !== skip && !VERIFY_EXEMPT.has(k) &&
      k !== 'hyperliquid' && !k.startsWith('meteora-') &&   // pseudo-holdings carry value on price by design
      unitsOf(h) * h.price >= VERIFY_MIN_VALUE_USD
  })
  if (!targets.length) return

  const dex = await fetchDexScreenerPrices(targets.map(keyOf))
  for (const h of targets) {
    const units = unitsOf(h)
    const d = dex.get(keyOf(h))
    const label = h.symbol || d?.symbol || keyOf(h).slice(0, 8)
    if (!d) {
      // Significant implied value but no trusted-quote pool over the liquidity
      // floor anywhere — unverifiable, so it must not count toward net worth.
      console.warn(`[dex-verify] ${label}: $${Math.round(units * h.price).toLocaleString()} implied but NO trusted pool — left unpriced`)
      h.priceRejected = true
      h.price = 0
      h.value = 0
      continue
    }
    let price = h.price
    if (price > d.price * VERIFY_MAX_DEVIATION || price < d.price / VERIFY_MAX_DEVIATION) {
      console.warn(`[dex-verify] ${label}: source price $${h.price} vs verified $${d.price} — using verified`)
      price = d.price
    }
    const value = units * price
    if (value > (d._liq || 0) * MAX_VALUE_TO_LIQ) {
      console.warn(`[dex-verify] ${label}: value $${Math.round(value).toLocaleString()} dwarfs pool liq $${Math.round(d._liq || 0).toLocaleString()} — left unpriced`)
      h.priceRejected = true
      h.price = 0
      h.value = 0
    } else if (price !== h.price) {
      h.price = price
      h.value = value
    }
  }
}

/** Map(addressLower -> { price, symbol, name, _liq }). Picks the highest-liquidity pair ≥ the floor. */
export async function fetchDexScreenerPrices(addresses = []) {
  const out = new Map()
  const uniq = [...new Set(addresses.map(a => (a || '').toLowerCase()).filter(Boolean))]

  // Serve fresh-enough entries from cache; only fetch the rest.
  const now = Date.now()
  const toFetch = []
  for (const a of uniq) {
    const c = _priceCache.get(a)
    if (c && now - c.ts < PRICE_TTL_MS) out.set(a, { price: c.price, symbol: c.symbol, name: c.name, _liq: c._liq })
    else toFetch.push(a)
  }

  for (let i = 0; i < toFetch.length; i += 30) {         // API accepts up to ~30 per call
    const batch = toFetch.slice(i, i + 30)
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const data = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`,
        { signal: ctrl.signal, headers: { accept: 'application/json' } }
      ).then(r => (r.ok ? r.json() : null)).catch(() => null)
      clearTimeout(t)

      for (const pair of (data?.pairs || [])) {
        const addr = pair?.baseToken?.address?.toLowerCase()
        const price = parseFloat(pair?.priceUsd)
        if (!addr || !(price > 0)) continue
        const liq = parseFloat(pair?.liquidity?.usd) || 0
        if (liq < MIN_LIQ_USD) continue                  // scam/dust pool — cannot price anything
        if (!quoteAllowed(pair)) continue                // junk quote token — its USD liq is fiction
        const prev = out.get(addr)
        if (!prev || liq > prev._liq) {                  // keep most-liquid pair (most reliable)
          out.set(addr, { price, symbol: pair.baseToken.symbol || null, name: pair.baseToken.name || null, _liq: liq })
        }
      }
    } catch { /* ignore batch */ }
  }

  // Cache the freshly fetched results (cache hits already carry their own ts).
  const ts = Date.now()
  for (const a of toFetch) {
    const v = out.get(a)
    if (v) _priceCache.set(a, { ...v, ts })
  }
  return out
}

// A price is only meaningful if the pool could plausibly absorb the position.
// If units × price exceeds this multiple of the pair's liquidity, the "value"
// could never be realized (fabricated price or airdropped mega-bag) — leave
// the token unpriced rather than inflate net worth.
const MAX_VALUE_TO_LIQ = Number(process.env.DEXSCREENER_MAX_VALUE_TO_LIQ ?? 2)

/**
 * Fill in prices for `holdings` rows that came back unpriced (price<=0 but held).
 * Mutates the rows; returns the total USD value added. Rows whose implied value
 * fails the liquidity sanity check are flagged `priceRejected: true` so callers
 * (last-price retention) don't resurrect a previously stored bogus price.
 */
export async function applyDexFallback(holdings = [], { skipMint } = {}) {
  const skip = (skipMint || '').toLowerCase()
  const keyOf = (h) => (h.mint || h.address || '').toLowerCase()     // Solana mint or EVM contract
  const unitsOf = (h) => (h.uiAmount ?? h.balance ?? 0)
  // Target tokens missing a price OR a symbol (a token can be priced by Jupiter
  // yet have no name because it isn't on the verified token list).
  const targets = holdings.filter(h => {
    const k = keyOf(h)
    return h && unitsOf(h) > 0 && (!(h.price > 0) || !h.symbol) && k && k !== 'native' && k !== skip
  })
  if (!targets.length) return 0

  const dex = await fetchDexScreenerPrices(targets.map(keyOf))
  let added = 0
  for (const h of targets) {
    const d = dex.get(keyOf(h))
    if (!d) continue
    if (!(h.price > 0) && d.price > 0) {
      const value = unitsOf(h) * d.price
      if (value > (d._liq || 0) * MAX_VALUE_TO_LIQ) {
        // Position dwarfs the pool — this price is not usable for this bag.
        h.priceRejected = true
        console.warn(`[dex] rejected price for ${d.symbol || keyOf(h).slice(0, 8)}: implied value $${Math.round(value).toLocaleString()} vs pool liquidity $${Math.round(d._liq || 0).toLocaleString()}`)
      } else {
        h.price = d.price
        h.value = value
        added += value
      }
    }
    if (!h.symbol && d.symbol) h.symbol = d.symbol
    if (!h.name && d.name) h.name = d.name
  }
  return added
}
