import fetch from 'node-fetch'

// Blockscout exposes a free, key-less `tokenlist` endpoint that returns every
// token balance an address holds (contract, symbol, decimals, raw balance).
// This is what gives EVM the same token auto-discovery Solana already has —
// without it we can only see contracts the user manually tracked.
//
// No public Blockscout instance covers BNB Chain, so BNB still relies on the
// tracked-address watchlist. Robinhood Chain's official explorer IS a
// Blockscout instance (verified 2026-07), so discovery works there natively.
const BLOCKSCOUT = {
  ethereum: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  robinhood: 'https://robinhoodchain.blockscout.com',
}

export function blockscoutSupports(chainName) {
  return Boolean(BLOCKSCOUT[(chainName || '').toLowerCase()])
}

/**
 * Discover ERC-20 token balances for an address on a chain.
 * Returns [{ address, symbol, name, decimals, balanceRaw, uiAmount }] with
 * zero balances and non-ERC-20 (NFT) entries already filtered out.
 * Returns [] on any error so callers degrade to the watchlist path.
 */
export async function fetchBlockscoutTokens(address, chainName) {
  const base = BLOCKSCOUT[(chainName || '').toLowerCase()]
  if (!base || !address) return []

  const url = `${base}/api?module=account&action=tokenlist&address=${address}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const data = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
    clearTimeout(t)

    if (!data || data.status !== '1' || !Array.isArray(data.result)) return []

    const out = []
    for (const r of data.result) {
      // Only fungible tokens — skip ERC-721/1155 NFTs.
      if (r.type && !/^ERC-20$/i.test(r.type)) continue
      const addr = (r.contractAddress || '').toLowerCase()
      if (!/^0x[0-9a-f]{40}$/.test(addr)) continue
      const decimals = parseInt(r.decimals, 10)
      const dec = Number.isFinite(decimals) ? decimals : 18
      let bal
      try { bal = BigInt(r.balance || '0') } catch { continue }
      if (bal === 0n) continue
      const uiAmount = Number(bal) / 10 ** dec
      if (!(uiAmount > 0)) continue
      out.push({
        address: addr,
        symbol: r.symbol || null,
        name: r.name || null,
        decimals: dec,
        balanceRaw: r.balance,
        uiAmount,
      })
    }
    return out
  } catch {
    return []
  }
}
