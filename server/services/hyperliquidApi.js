import fetch from 'node-fetch'

const API = 'https://api.hyperliquid.xyz/info'

const num = (x) => {
  const n = parseFloat(x)
  return isNaN(n) ? 0 : n
}

/**
 * Fetch a Hyperliquid account's perp positions + spot balances + equity.
 * Public API, no key needed. `address` is the user's EVM address.
 */
export async function fetchHyperliquidState(address) {
  const post = (body) =>
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null)

  const [perp, spot, mids] = await Promise.all([
    post({ type: 'clearinghouseState', user: address }),
    post({ type: 'spotClearinghouseState', user: address }),
    post({ type: 'allMids' }),
  ])

  const accountValue   = num(perp?.marginSummary?.accountValue)        // perp equity (margin + uPnL)
  const totalNtlPos    = num(perp?.marginSummary?.totalNtlPos)         // total notional open
  const totalMarginUsed = num(perp?.marginSummary?.totalMarginUsed)
  const withdrawable   = num(perp?.withdrawable)

  const positions = (perp?.assetPositions || []).map(ap => {
    const p = ap.position || {}
    const szi = num(p.szi)
    const positionValue = num(p.positionValue)
    return {
      coin: p.coin,
      side: szi >= 0 ? 'long' : 'short',
      size: Math.abs(szi),
      entryPx: num(p.entryPx),
      markPx: szi !== 0 ? positionValue / Math.abs(szi) : 0,
      positionValue,
      unrealizedPnl: num(p.unrealizedPnl),
      roe: num(p.returnOnEquity) * 100,
      leverage: p.leverage?.value ?? null,
      leverageType: p.leverage?.type ?? null,
      liquidationPx: num(p.liquidationPx),
      marginUsed: num(p.marginUsed),
    }
  }).filter(p => p.size > 0)

  // Spot balances valued via mids (USDC = $1; others use the matching mid if available)
  let spotValue = 0
  const spotBalances = (spot?.balances || []).map(b => {
    const total = num(b.total)
    const price = b.coin === 'USDC' ? 1 : num(mids?.[b.coin])
    const value = total * price
    spotValue += value
    return { coin: b.coin, total, value }
  }).filter(b => b.value > 0.01)

  return {
    accountValue,
    spotValue,
    totalValue: accountValue + spotValue,
    withdrawable,
    totalMarginUsed,
    totalNtlPos,
    unrealizedPnl: positions.reduce((s, p) => s + p.unrealizedPnl, 0),
    positions,
    spot: spotBalances,
  }
}
