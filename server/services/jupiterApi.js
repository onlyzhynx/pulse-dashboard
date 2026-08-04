/**
 * Jupiter API integration for Solana.
 * - Token List: free cached token map for symbol/name resolution
 * - Ultra Holdings: token balances + native SOL (GET /ultra/v1/holdings/{address})
 * - Portfolio: DeFi positions (staked JUP, LP, etc.) with USD value (GET /portfolio/v1/positions/{address})
 * - Price: USD prices for mints (GET /price/v3?ids=), up to 50 per request, batched automatically
 * Requires x-api-key (free at https://portal.jup.ag) for Holdings/Portfolio/Price.
 * @see https://dev.jup.ag/docs/portfolio
 * @see https://dev.jup.ag/docs/ultra/get-holdings
 * @see https://dev.jup.ag/docs/price
 */

const JUPITER_BASE = "https://api.jup.ag";

// ── Token map cache (symbol/name resolution, refreshed hourly) ────────────────
let _tokenMapCache = null;
let _tokenMapExpiry = 0;
const TOKEN_MAP_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch Jupiter verified token list and return a Map<mintLower, {symbol, name}>.
 * Free endpoint — no API key required.
 * @returns {Promise<Map<string, {symbol: string|null, name: string|null}>>}
 */
export async function getTokenMap() {
  if (_tokenMapCache && Date.now() < _tokenMapExpiry) return _tokenMapCache;
  try {
    const res = await fetch("https://tokens.jup.ag/tokens", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Token list HTTP ${res.status}`);
    const list = await res.json();
    const map = new Map();
    if (Array.isArray(list)) {
      for (const t of list) {
        if (t.address) {
          map.set(t.address.toLowerCase(), {
            symbol: t.symbol || null,
            name: t.name || null,
          });
        }
      }
    }
    _tokenMapCache = map;
    _tokenMapExpiry = Date.now() + TOKEN_MAP_TTL;
    console.log(`[Jupiter] Token map loaded: ${map.size} tokens`);
    return map;
  } catch (e) {
    console.warn("[Jupiter] Token list fetch failed:", e.message);
    return _tokenMapCache || new Map();
  }
}

// ── Holdings ──────────────────────────────────────────────────────────────────

/**
 * Fetch token holdings + native SOL for a wallet (Ultra API).
 * @param {string} address - Solana wallet address
 * @param {string} apiKey - Jupiter API key (portal.jup.ag)
 * @returns {Promise<{ nativeSol: number, tokens: Array<{ mint: string, uiAmount: number, decimals: number, amount: string }> }>}
 */
export async function fetchHoldings(address, apiKey) {
  if (!address || !apiKey) {
    throw new Error("Jupiter: address and apiKey required");
  }
  const url = `${JUPITER_BASE}/ultra/v1/holdings/${address}`;
  const res = await fetch(url, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter holdings ${res.status}: ${text || res.statusText}`);
  }
  const data = await res.json();

  // Top-level is native SOL: uiAmount (human) or amount (lamports)
  const nativeSol =
    Number(data.uiAmount ?? data.uiAmountString ?? 0) ||
    (Number(data.amount ?? 0) / 1e9) ||
    0;
  const tokens = [];
  const tokensMap = data.tokens || {};
  for (const [mint, accounts] of Object.entries(tokensMap)) {
    if (!Array.isArray(accounts) || !mint) continue;
    let totalUi = 0;
    let decimals = 9;
    let totalRaw = "0";
    for (const acc of accounts) {
      const ui = Number(acc.uiAmount ?? acc.uiAmountString ?? 0) || 0;
      totalUi += ui;
      if (acc.decimals != null) decimals = acc.decimals;
      const raw = acc.amount || "0";
      totalRaw = (BigInt(totalRaw) + BigInt(raw)).toString();
    }
    if (totalUi > 0 || totalRaw !== "0") {
      tokens.push({ mint, uiAmount: totalUi, decimals, amount: totalRaw });
    }
  }
  return { nativeSol, tokens };
}

// ── Prices ────────────────────────────────────────────────────────────────────

/**
 * Fetch USD prices for Solana mints (Price API v3).
 * Automatically batches into groups of 50. Works with or without an API key.
 * @param {string[]} mints - SPL mint addresses
 * @param {string} [apiKey] - Jupiter API key (optional)
 * @returns {Promise<Map<string, {price: number, priceChange24h: number|null, decimals: number|null}>>}
 *   Key is mint address in lowercase.
 */
export async function fetchPrices(mints, apiKey) {
  if (!mints || !mints.length) return new Map();
  const unique = [...new Set(mints.filter(Boolean))];
  const BATCH = 50;
  const map = new Map();

  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const ids = chunk.join(",");
    const url = `${JUPITER_BASE}/price/v3?ids=${encodeURIComponent(ids)}`;
    const headers = apiKey ? { "x-api-key": apiKey } : {};
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`[Jupiter] Price API HTTP ${res.status} (batch ${Math.floor(i / BATCH) + 1})`);
        continue;
      }
      const data = await res.json();
      if (typeof data === "object" && data !== null) {
        for (const [mint, obj] of Object.entries(data)) {
          const price = obj?.usdPrice ?? obj?.price;
          if (mint && typeof price === "number" && price > 0) {
            map.set(String(mint).toLowerCase(), {
              price,
              priceChange24h: obj?.priceChange24h ?? null,
              decimals: obj?.decimals ?? null,
            });
          }
        }
      }
    } catch (e) {
      console.warn(`[Jupiter] Price batch ${Math.floor(i / BATCH) + 1} failed:`, e.message);
    }
  }
  return map;
}

// ── Positions ─────────────────────────────────────────────────────────────────

/**
 * Fetch DeFi positions (Portfolio API): staked JUP, LP, limit orders, etc.
 * @param {string} address - Solana wallet address
 * @param {string} apiKey - Jupiter API key
 * @returns {Promise<{ totalValue: number, positions: Array<{ label: string, value: number, type: string }> }>}
 */
export async function fetchPositions(address, apiKey) {
  if (!address || !apiKey) {
    return { totalValue: 0, positions: [] };
  }
  const url = `${JUPITER_BASE}/portfolio/v1/positions/${address}`;
  const res = await fetch(url, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.warn("[Jupiter] positions failed:", res.status, await res.text());
    return { totalValue: 0, positions: [] };
  }
  const data = await res.json();
  const elements = data.elements || data.positions || [];
  const positions = [];
  let totalValue = 0;
  for (const el of elements) {
    const value = Number(el.value ?? 0) || 0;
    totalValue += value;
    positions.push({
      label: el.label || el.type || "Position",
      value,
      type: el.type,
      platformId: el.platformId,
    });
  }
  return { totalValue, positions };
}
