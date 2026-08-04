import fetch from 'node-fetch'

/**
 * Meteora liquidity-pool positions for a wallet (datapi, no key needed).
 *  - DLMM:    GET https://dlmm.datapi.meteora.ag/portfolio/open?user={wallet}
 *  - DAMM v2: GET https://damm-v2.datapi.meteora.ag/wallets/{wallet}/open_positions
 * Position value = current balance + unclaimed fees (both are real money).
 */

const num = (x) => {
  const n = parseFloat(x)
  return isNaN(n) ? 0 : n
}

const get = async (url) => {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 12000)
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    clearTimeout(t)
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** Returns [{ protocol, pool, symbol, name, valueUsd, unclaimedUsd, pnlUsd, pnlPct, outOfRange }] */
export async function fetchMeteoraPositions(wallet) {
  const [dlmm, damm] = await Promise.all([
    get(`https://dlmm.datapi.meteora.ag/portfolio/open?user=${wallet}`),
    get(`https://damm-v2.datapi.meteora.ag/wallets/${wallet}/open_positions`),
  ])

  const positions = []

  // ── DLMM (numeric strings; one entry per pool, may hold several positions) ──
  for (const p of dlmm?.pools || []) {
    const value = num(p.balances) + num(p.unclaimedFees)
    if (value <= 0) continue
    const pair = `${p.tokenX || '?'}-${p.tokenY || '?'}`
    positions.push({
      protocol: 'DLMM',
      pool: p.poolAddress,
      symbol: `${pair} LP`,
      name: `Meteora DLMM ${pair}${p.outOfRange ? ' (out of range)' : ''}`,
      valueUsd: value,
      unclaimedUsd: num(p.unclaimedFees),
      pnlUsd: num(p.pnl),
      pnlPct: num(p.pnlPctChange),
      outOfRange: !!p.outOfRange,
    })
  }

  // ── DAMM v2 (plain numbers; parse defensively, per-position) ──
  let dammParsed = 0
  for (const p of damm?.data || []) {
    const value =
      num(p?.current_deposits?.amount_usd) ||
      num(p?.balances) || num(p?.balance_usd) || num(p?.total_value_usd)
    const fees = num(p?.unclaimed_fees?.amount_usd ?? p?.unclaimed_fees)
    if (value + fees <= 0) continue
    const pair = p?.pool_name || (p?.token_x?.symbol && p?.token_y?.symbol
      ? `${p.token_x.symbol}-${p.token_y.symbol}` : null)
    const pool = p?.pool_address || p?.position_address || 'unknown'
    positions.push({
      protocol: 'DAMM v2',
      pool,
      symbol: `${pair || pool.slice(0, 6)} LP`,
      name: `Meteora DAMM v2 ${pair || pool.slice(0, 8)}`,
      valueUsd: value + fees,
      unclaimedUsd: fees,
      pnlUsd: num(p?.pnl),
      pnlPct: num(p?.pnl_change_pct ?? p?.pnl_pct_change),
      outOfRange: false,
    })
    dammParsed++
  }
  // Safety net: if per-position parsing got nothing but the API reports a total,
  // record one aggregate row so the value still counts toward net worth.
  const dammTotal = num(damm?.total?.balances) + num(damm?.total?.unclaimed_fees)
  if (dammParsed === 0 && dammTotal > 0) {
    positions.push({
      protocol: 'DAMM v2',
      pool: 'aggregate',
      symbol: 'DAMM v2 LPs',
      name: `Meteora DAMM v2 positions (${damm?.total_positions ?? '?'})`,
      valueUsd: dammTotal,
      unclaimedUsd: num(damm?.total?.unclaimed_fees),
      pnlUsd: num(damm?.total?.pnl),
      pnlPct: num(damm?.total?.pnl_pct_change),
      outOfRange: false,
    })
  }

  return positions
}

/** Pseudo-holding rows so LP positions surface in Holdings + wallet totals. */
export function toHoldingTokens(positions) {
  return positions.map(p => ({
    mint: `meteora-${p.protocol.toLowerCase().replace(/\s+/g, '')}-${p.pool}`,
    chain: 'meteora',
    chainDisplay: `Meteora ${p.protocol}`,
    symbol: p.symbol,
    name: p.name,
    uiAmount: 1,
    price: p.valueUsd,   // value rides on price so units*price = position USD value
  }))
}
