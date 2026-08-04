import fetch from "node-fetch";

/**
 * GeckoTerminal API Integration
 * https://www.geckoterminal.com/api-docs
 * 
 * GeckoTerminal provides better rate limits and more reliable data than the public CoinGecko API.
 * Base URL: https://api.geckoterminal.com/api/v2
 */

const GECKOTERMINAL_BASE_URL = "https://api.geckoterminal.com/api/v2";
const SOLANA_NETWORK = "solana";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches token data from GeckoTerminal by contract addresses.
 * Uses the multi-token endpoint (30 per request). Retries once on 429.
 * @param {Array<string>} addresses - Array of token contract addresses
 * @param {string} network - Network name (default: "solana")
 * @returns {Promise<Map<string, Object>>} Map of address to token data
 */
export async function fetchTokensByAddresses(addresses, network = SOLANA_NETWORK) {
  if (!addresses || addresses.length === 0) return new Map();

  const batchSize = 30;
  const resultMap = new Map();

  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const batchData = await fetchTokensBatch(batch, network);
    for (const [address, data] of batchData.entries()) {
      resultMap.set(address, data);
    }
    // Small gap between batches to avoid rate limits
    if (i + batchSize < addresses.length) {
      await sleep(500);
    }
  }

  return resultMap;
}

/**
 * Fetches a batch of tokens from GeckoTerminal using the multi-token endpoint.
 * GET /networks/{network}/tokens/multi/{comma-separated-addresses}
 * Supports up to 30 addresses per request — single HTTP call, no per-token delay.
 * @param {Array<string>} addresses - Array of token contract addresses (max 30)
 * @param {string} network - Network name
 * @returns {Promise<Map<string, Object>>} Map of address (lowercase) to token data
 */
async function fetchTokensBatch(addresses, network) {
  const resultMap = new Map();
  if (!addresses || addresses.length === 0) return resultMap;

  const filtered = addresses.filter(Boolean);
  if (filtered.length === 0) return resultMap;

  // Multi-token endpoint: comma-separated addresses in path
  const addressList = filtered.join(",");
  const url = `${GECKOTERMINAL_BASE_URL}/networks/${network}/tokens/multi/${encodeURIComponent(addressList)}`;

  const doFetch = async () => fetch(url, { headers: { accept: "application/json" } });

  let response = await doFetch();

  // Retry once on 429 after a short back-off
  if (response.status === 429) {
    await sleep(3000);
    response = await doFetch();
  }

  try {
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`GeckoTerminal multi-token fetch failed: ${response.status}`);
      }
      return resultMap;
    }

    const data = await response.json();
    // Response: { data: [ { id, type, attributes: {...} }, ... ] }
    const items = data?.data;
    if (!Array.isArray(items)) return resultMap;

    for (const item of items) {
      const attrs = item?.attributes;
      if (!attrs) continue;

      // address comes from attributes; fall back to parsing from id (e.g. "solana_<address>")
      const tokenAddress = attrs.address || (item.id?.includes("_") ? item.id.split("_").slice(1).join("_") : null);
      if (!tokenAddress) continue;

      const addrLower = tokenAddress.toLowerCase();
      resultMap.set(addrLower, {
        address: tokenAddress,
        name: attrs.name || null,
        symbol: attrs.symbol || null,
        price_usd: parseFloat(attrs.price_usd) || 0,
        market_cap_usd: parseFloat(attrs.market_cap_usd) || 0,
        fdv_usd: parseFloat(attrs.fdv_usd) || 0,
        volume_24h: parseFloat(attrs.volume_usd?.h24) || 0,
        price_change_percentage: {
          h1: parseFloat(attrs.price_change_percentage?.h1) || 0,
          h24: parseFloat(attrs.price_change_percentage?.h24) || 0,
          h6: parseFloat(attrs.price_change_percentage?.h6) || 0,
        },
        coingecko_coin_id: attrs.coingecko_coin_id || null,
        image_url: attrs.image_url || null,
      });
    }
  } catch (error) {
    console.warn("GeckoTerminal multi-token fetch error:", error.message);
  }

  return resultMap;
}

/**
 * Fetches USD prices and metadata for SPL tokens from GeckoTerminal
 * @param {Array<string>} mints - Array of token mint addresses
 * @returns {Promise<Map<string, Object>>} Map of mint address to {price, symbol, name}
 */
export async function fetchTokenPrices(mints) {
  if (!mints || mints.length === 0) {
    return new Map();
  }

  const uniqueMints = [...new Set(mints)];
  const tokenData = await fetchTokensByAddresses(uniqueMints, SOLANA_NETWORK);
  
  const resultMap = new Map();
  for (const [address, data] of tokenData.entries()) {
    resultMap.set(address, {
      price: data.price_usd || 0,
      symbol: data.symbol || null,
      name: data.name || null,
    });
  }

  return resultMap;
}

/**
 * Fetches SOL price from GeckoTerminal using the multi-token endpoint (same as other tokens).
 * @returns {Promise<number>} SOL price in USD
 */
export async function fetchSolPrice() {
  const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
  try {
    const map = await fetchTokensBatch([SOL_ADDRESS], SOLANA_NETWORK);
    return map.get(SOL_ADDRESS.toLowerCase())?.price_usd || 0;
  } catch (error) {
    console.warn("Failed to fetch SOL price from GeckoTerminal:", error.message);
    return 0;
  }
}

/**
 * Fetches detailed market data for tokens by their contract addresses
 * @param {Array<string>} addresses - Array of token contract addresses
 * @param {string} network - Network name (default: "solana")
 * @returns {Promise<Map<string, Object>>} Map of address to market data
 */
export async function fetchMarketData(addresses, network = SOLANA_NETWORK) {
  if (!addresses || addresses.length === 0) {
    return new Map();
  }

  const tokenData = await fetchTokensByAddresses(addresses, network);
  
  // Transform to match expected format from CoinGecko
  // Use lowercase addresses as keys for consistent lookup
  const marketMap = new Map();
  for (const [address, data] of tokenData.entries()) {
    // Address is already lowercase from fetchTokensByAddresses
    marketMap.set(address, {
      current_price: data.price_usd || 0,
      market_cap: data.market_cap_usd || data.fdv_usd || 0,
      price_change_percentage_1h_in_currency: data.price_change_percentage?.h1 || 0,
      price_change_percentage_6h_in_currency: data.price_change_percentage?.h6 || 0,
      price_change_percentage_24h_in_currency: data.price_change_percentage?.h24 || 0,
      // GeckoTerminal doesn't provide 7d, 14d, 30d by default, but we can try to get from pools
      price_change_percentage_7d_in_currency: 0,
      price_change_percentage_14d_in_currency: 0,
      price_change_percentage_30d_in_currency: 0,
    });
  }

  console.log(`Fetched market data for ${marketMap.size} tokens (requested ${addresses.length})`);
  return marketMap;
}

/**
 * Searches for a token by contract address to get basic info
 * Uses the full endpoint with top_pools to get market cap and better price data
 * @param {string} contractAddress - Token contract address
 * @param {string} network - Network name (default: "solana")
 * @returns {Promise<Object|null>} Token info or null if not found
 */
export async function findTokenByAddress(contractAddress, network = SOLANA_NETWORK) {
  try {
    // Use the full endpoint with top_pools to get market cap data (as shown in API docs)
    const url = `${GECKOTERMINAL_BASE_URL}/networks/${network}/tokens/${contractAddress}?include=top_pools&include_composition=false`;
    
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    if (!data?.data?.attributes) {
      return null;
    }

    const attrs = data.data.attributes;
    
    // Get market cap from top pool if not directly available
    let marketCapUsd = parseFloat(attrs.market_cap_usd) || 0;
    let priceUsd = parseFloat(attrs.price_usd) || 0;
    
    // If market cap not in attributes, try getting from top pool
    if (!marketCapUsd && data.included && data.included.length > 0) {
      const topPool = data.included.find(pool => pool.type === 'pool' && pool.attributes);
      if (topPool && topPool.attributes) {
        marketCapUsd = parseFloat(topPool.attributes.market_cap_usd) || parseFloat(topPool.attributes.fdv_usd) || 0;
        // Use pool price if token price is missing
        if (!priceUsd) {
          priceUsd = parseFloat(topPool.attributes.token_price_usd) || parseFloat(topPool.attributes.base_token_price_usd) || 0;
        }
      }
    }
    
    return {
      address: attrs.address,
      name: attrs.name,
      symbol: attrs.symbol,
      price_usd: priceUsd,
      market_cap_usd: marketCapUsd,
      fdv_usd: parseFloat(attrs.fdv_usd) || marketCapUsd || 0,
      coingecko_coin_id: attrs.coingecko_coin_id || null,
      image_url: attrs.image_url || null,
    };
  } catch (error) {
    console.warn("Failed to find token on GeckoTerminal:", error.message);
    return null;
  }
}
