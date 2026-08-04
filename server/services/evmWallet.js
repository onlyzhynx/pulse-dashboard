import fetch from "node-fetch";
import Big from "bignumber.js";
import { applyDexFallback } from "./dexScreenerApi.js";
import { fetchBlockscoutTokens } from "./blockscoutApi.js";

// Discovered tokens (not on the watchlist) must clear this USD value to be kept,
// so the thousands of spam/airdrop dust tokens a wallet collects don't show up.
const EVM_MIN_TOKEN_USD = Number(process.env.EVM_MIN_TOKEN_USD ?? 1);

/**
 * EVM Wallet Service
 * Supports Ethereum, Base, and BNB Chain wallet tracking
 * Uses public RPC endpoints and CoinGecko for pricing
 */

// Multiple public RPCs per chain — tried in order so one provider being down
// (e.g. llamarpc 521s) doesn't break the chain.
const RPC_URLS = {
  ethereum: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
  ],
  base: [
    "https://mainnet.base.org",
    "https://base-rpc.publicnode.com",
    "https://base.llamarpc.com",
  ],
  bnb: [
    "https://bsc-dataseed.binance.org",
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed1.defibit.io",
  ],
  // Robinhood Chain (Arbitrum Orbit L2, chain 4663). Only the official public
  // RPC exists for now (dRPC gates it behind paid tier — verified 2026-07).
  robinhood: [
    "https://rpc.mainnet.chain.robinhood.com",
  ],
};

// Chain configurations - All EVM chains handled uniformly
const CHAINS = {
  ethereum: {
    id: 1,
    name: "Ethereum",
    rpcUrl: RPC_URLS.ethereum[0],
    rpcUrls: RPC_URLS.ethereum,
    nativeCurrency: { symbol: "ETH", decimals: 18, coingeckoId: "ethereum" },
    explorer: "https://etherscan.io",
  },
  eth: { // Alias for ethereum
    id: 1,
    name: "Ethereum",
    rpcUrl: RPC_URLS.ethereum[0],
    rpcUrls: RPC_URLS.ethereum,
    nativeCurrency: { symbol: "ETH", decimals: 18, coingeckoId: "ethereum" },
    explorer: "https://etherscan.io",
  },
  base: {
    id: 8453,
    name: "Base",
    rpcUrl: RPC_URLS.base[0],
    rpcUrls: RPC_URLS.base,
    nativeCurrency: { symbol: "ETH", decimals: 18, coingeckoId: "ethereum" },
    explorer: "https://basescan.org",
  },
  bnb: {
    id: 56,
    name: "BNB Chain",
    rpcUrl: RPC_URLS.bnb[0],
    rpcUrls: RPC_URLS.bnb,
    nativeCurrency: { symbol: "BNB", decimals: 18, coingeckoId: "binancecoin" },
    explorer: "https://bscscan.com",
  },
  bsc: { // Alias for bnb
    id: 56,
    name: "BNB Chain",
    rpcUrl: RPC_URLS.bnb[0],
    rpcUrls: RPC_URLS.bnb,
    nativeCurrency: { symbol: "BNB", decimals: 18, coingeckoId: "binancecoin" },
    explorer: "https://bscscan.com",
  },
  robinhood: {
    id: 4663,
    name: "Robinhood Chain",
    rpcUrl: RPC_URLS.robinhood[0],
    rpcUrls: RPC_URLS.robinhood,
    nativeCurrency: { symbol: "ETH", decimals: 18, coingeckoId: "ethereum" },
    explorer: "https://robinhoodchain.blockscout.com",
  },
};

// POST a JSON-RPC payload, falling back across the chain's RPC endpoints until
// one returns a non-error result. Throws only if every endpoint fails.
async function callEvmRpc(chain, payload, timeoutMs = 8000) {
  const urls = chain.rpcUrls || [chain.rpcUrl];
  let lastErr;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) { lastErr = new Error(`RPC ${response.status}`); continue; }
      const data = await response.json();
      if (data.error) { lastErr = new Error(data.error.message || "RPC error"); continue; }
      return data.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("All RPC endpoints failed");
}

// ERC-20 ABI for balanceOf and decimals
const ERC20_ABI = {
  balanceOf: "0x70a08231",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  name: "0x06fdde03",
};

/**
 * Fetches EVM wallet holdings across ALL supported chains
 * @param {string} walletAddress - EVM wallet address
 * @param {Object} holdingsByChain - Optional map of chain -> token addresses from holdings to check
 * @returns {Promise<{totalValue: number, tokens: Array}>}
 */
export async function fetchAllEVMChainsValue(walletAddress, holdingsByChain = {}) {
  // Main EVM chains (no aliases) — all fetched in parallel, so adding a chain
  // doesn't add wall time.
  const mainChains = ["ethereum", "base", "bnb", "robinhood"];
  
  console.log(`🔍 Fetching ${walletAddress} across ${mainChains.length} EVM chains...`);
  
  // Add overall timeout (60 seconds for all chains with ERC-20 checks)
  const overallTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('EVM fetch timeout across all chains')), 60000)
  );
  
  // Fetch from all chains in parallel with timeout
  const fetchPromise = Promise.allSettled(
    mainChains.map(chainName => {
      // Get token addresses for this chain from holdings
      const tokenAddresses = holdingsByChain[chainName] || holdingsByChain[chainName.toLowerCase()] || [];
      
      return fetchEVMWalletValue(walletAddress, chainName, tokenAddresses)
        .then(result => ({ chainName, ...result }))
        .catch(error => {
          console.warn(`  ⚠️  ${CHAINS[chainName].name} fetch failed:`, error.message);
          return { chainName, totalValue: 0, tokens: [] };
        });
    })
  );
  
  let results;
  try {
    results = await Promise.race([fetchPromise, overallTimeout]);
  } catch (timeoutError) {
    console.warn(`⚠️  EVM fetch timeout for ${walletAddress}, returning empty data`);
    return { totalValue: 0, tokens: [] };
  }
  
  // Combine successful results
  let totalValue = 0;
  const allTokens = [];
  
  if (Array.isArray(results)) {
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        const chainName = mainChains[index];
        const data = result.value;
        
        // Add chain info to tokens
        if (data && data.tokens && Array.isArray(data.tokens)) {
          data.tokens.forEach(token => {
            allTokens.push({
              ...token,
              chain: chainName,
              chainDisplay: CHAINS[chainName]?.name || chainName,
            });
          });
        }
        
        totalValue += data?.totalValue || 0;
        console.log(`  ✅ ${CHAINS[chainName]?.name || chainName}: $${(data?.totalValue || 0).toFixed(2)}`);
      } else {
        const chainName = mainChains[index];
        console.log(`  ⚠️  ${CHAINS[chainName]?.name || chainName}: ${result.reason?.message || 'Failed'}`);
      }
    });
  }
  
  const { tokens: keptTokens, totalValue: pruned } = await priceAndPruneEvmTokens(allTokens);
  console.log(`  💰 Total across all chains: $${pruned.toFixed(2)}`);

  return {
    totalValue: pruned,
    tokens: keptTokens,
  };
}

/**
 * Price unpriced tokens (DexScreener) and drop discovered dust. Native tokens and
 * watchlisted/tracked tokens are always kept; everything else must clear
 * EVM_MIN_TOKEN_USD. Shared by the multi-chain and single-chain paths so both
 * filter spam/airdrop tokens identically.
 * @returns {Promise<{tokens: Array, totalValue: number}>}
 */
export async function priceAndPruneEvmTokens(tokens = []) {
  try { await applyDexFallback(tokens); } catch (e) { console.warn('dex fallback:', e.message); }

  const kept = tokens.filter(t =>
    t.address === 'native' || t.tracked || ((t.value || 0) >= EVM_MIN_TOKEN_USD)
  );
  const dropped = tokens.length - kept.length;
  if (dropped > 0) console.log(`  🧹 Dropped ${dropped} dust/unpriced EVM tokens`);

  const totalValue = kept.reduce((s, t) => s + (t.value || 0), 0);
  return { tokens: kept, totalValue };
}

/**
 * Single-chain fetch with the same discovery + dust-pruning as the multi-chain
 * path. Use this (not the raw fetchEVMWalletValue) for chain-specific wallets.
 * @returns {Promise<{tokens: Array, totalValue: number}>}
 */
export async function fetchEVMChainValuePruned(walletAddress, chainName, trackedAddresses = []) {
  const data = await fetchEVMWalletValue(walletAddress, chainName, trackedAddresses);
  return priceAndPruneEvmTokens(data.tokens || []);
}

/**
 * Fetches EVM wallet holdings for a single chain (native + ERC-20 tokens)
 * @param {string} walletAddress - EVM wallet address
 * @param {string} chainName - Chain name (ethereum, base, bnb, robinhood)
 * @param {Array} holdingsTokenAddresses - Optional array of token addresses from holdings to check
 * @returns {Promise<{totalValue: number, tokens: Array, nativeBalance: number}>}
 */
export async function fetchEVMWalletValue(walletAddress, chainName = "ethereum", holdingsTokenAddresses = []) {
  const chain = CHAINS[chainName.toLowerCase()];
  
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainName}`);
  }

  try {
    // Native balance, native price, and Blockscout token discovery are fully
    // independent — run all three concurrently. Blockscout is the long pole
    // (up to 15s); the old serial order stacked the RPC + price latency on top
    // of it. Each is individually non-fatal: a flaky RPC must not hide the
    // ERC-20s and vice versa.
    const [balRes, priceRes, discRes] = await Promise.allSettled([
      getNativeBalance(walletAddress, chain),
      fetchTokenPrice(chain.nativeCurrency.coingeckoId),
      fetchBlockscoutTokens(walletAddress, chainName),
    ]);
    const nativeBalance = balRes.status === "fulfilled" ? balRes.value : 0;
    const nativePrice = priceRes.status === "fulfilled" ? priceRes.value : 0;
    if (balRes.status === "rejected") {
      console.warn(`  ⚠️  Native balance unavailable on ${chain.name} (${balRes.reason?.message}); continuing with token discovery`);
    }

    // Calculate native value
    const nativeValue = new Big(nativeBalance).times(nativePrice);

    // Build holdings list starting with native token
    const holdings = [{
      address: "native",
      symbol: chain.nativeCurrency.symbol,
      name: chain.name,
      decimals: chain.nativeCurrency.decimals,
      balance: nativeBalance,
      price: nativePrice,
      value: nativeValue.toNumber(),
      chain: chainName.toLowerCase(),
      chainDisplay: chain.name,
    }];

    let totalTokenValue = nativeValue;

    // Auto-discovery: pull every ERC-20 balance the address holds from Blockscout
    // (free, no key). This is what lets EVM tokens show up without being manually
    // tracked. Balances/decimals come straight from Blockscout, so no RPC needed.
    // Prices are left at 0 and filled in one batch by applyDexFallback() later.
    // Watchlisted contracts are always kept (never dropped as dust), even when
    // Blockscout also discovers them.
    const watchSet = new Set((holdingsTokenAddresses || []).map(a => (a || "").toLowerCase()));
    const discovered = new Set();
    try {
      const found = discRes.status === "fulfilled" ? discRes.value : [];
      // Cap pricing work for spam-flooded wallets; beyond this it's ~all dust.
      const capped = found.slice(0, Number(process.env.EVM_MAX_DISCOVERED ?? 250));
      for (const t of capped) {
        discovered.add(t.address);
        holdings.push({
          tracked: watchSet.has(t.address),
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          balance: t.uiAmount,
          units: t.uiAmount,
          uiAmount: t.uiAmount,
          price: 0,
          value: 0,
          chain: chainName.toLowerCase(),
          chainDisplay: chain.name,
        });
      }
      if (found.length) console.log(`  🔎 Discovered ${found.length} ERC-20 tokens on ${chain.name} via Blockscout${capped.length < found.length ? ` (pricing first ${capped.length})` : ''}`);
    } catch (e) {
      console.warn(`  ⚠️  Blockscout discovery failed on ${chain.name}:`, e.message);
    }

    // Watchlisted contracts: fetch via RPC so they're always included even if
    // Blockscout missed them. Skip any already discovered above (no double rows).
    // These are flagged `tracked` so the dust filter never drops them.
    const trackedAddresses = (holdingsTokenAddresses || []).filter(
      a => a && a !== "native" && !discovered.has((a || "").toLowerCase())
    );
    if (trackedAddresses.length > 0) {
      const holdingsTokenAddresses = trackedAddresses; // shadow for the loop below
      console.log(`  → Checking ${holdingsTokenAddresses.length} ERC-20 token balances on ${chain.name}...`);
      
      // Fetch balances for tokens in holdings (in batches to avoid rate limits)
      const batchSize = 5;
      for (let i = 0; i < holdingsTokenAddresses.length; i += batchSize) {
        const batch = holdingsTokenAddresses.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (tokenAddress) => {
            try {
              // Skip native token address
              if (!tokenAddress || tokenAddress === "native") return;
              
              // Validate address format
              if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
                console.warn(`  ⚠️  Invalid token address: ${tokenAddress}`);
                return;
              }
              
              // Fetch token balance
              const tokenData = await getERC20Balance(walletAddress, tokenAddress, chain);
              
              if (!tokenData || !tokenData.balance || BigInt(tokenData.balance) === 0n) {
                // Token has no balance, skip it
                return;
              }
              
              // Convert balance to human-readable units
              const balance = new Big(tokenData.balance)
                .div(new Big(10).pow(tokenData.decimals))
                .toNumber();
              
              if (balance > 0) {
                // Price deliberately left at 0: priceAndPruneEvmTokens() prices
                // every unpriced token in ONE cached DexScreener batch. The old
                // per-token GeckoTerminal lookup here cost one HTTP call per
                // watchlisted token per chain per refresh.
                holdings.push({
                  address: tokenAddress.toLowerCase(), // Store in lowercase for consistency
                  symbol: null, // Will be filled by holdings snapshot
                  name: null,
                  decimals: tokenData.decimals,
                  balance: balance,
                  units: balance,
                  uiAmount: balance,
                  price: 0,
                  value: 0,
                  tracked: true, // watchlisted — dust filter must never drop it
                  chain: chainName.toLowerCase(),
                  chainDisplay: chain.name,
                });
                console.log(`  ✓ Found ${balance.toFixed(4)} tokens at ${tokenAddress.substring(0, 8)}... (${chain.name})`);
              }
            } catch (error) {
              // Silently skip tokens that fail (might not exist on this chain)
              // Only log if it's not a "token doesn't exist" error
              if (!error.message?.includes("revert") && !error.message?.includes("execution reverted")) {
                console.warn(`  ⚠️  Failed to fetch balance for ${tokenAddress?.substring(0, 8)}... on ${chain.name}:`, error.message);
              }
            }
          })
        );
        
        // Rate limiting: wait between batches
        if (i + batchSize < holdingsTokenAddresses.length) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between batches
        }
      }
    }

    return {
      totalValue: totalTokenValue.toNumber(),
      tokens: holdings,
      nativeBalance,
    };
  } catch (error) {
    console.error(`Failed to fetch ${chain.name} wallet value:`, error);
    throw error;
  }
}

/**
 * Fetches native balance for an EVM address
 * @param {string} address - Wallet address
 * @param {Object} chain - Chain configuration
 * @returns {Promise<number>} Balance in native units (ETH, BNB)
 */
async function getNativeBalance(address, chain) {
  const result = await callEvmRpc(chain, {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getBalance",
    params: [address, "latest"],
  });

  // Convert hex balance to decimal and then to native units
  const balanceWei = BigInt(result || "0x0");
  return new Big(balanceWei.toString())
    .div(new Big(10).pow(chain.nativeCurrency.decimals))
    .toNumber();
}

/**
 * Fetches ERC-20 token balance
 * @param {string} walletAddress - Wallet address
 * @param {string} tokenAddress - Token contract address
 * @param {Object} chain - Chain configuration
 * @returns {Promise<{balance: string, decimals: number}>}
 */
async function getERC20Balance(walletAddress, tokenAddress, chain) {
  // Encode balanceOf(address) call
  const balanceOfData = ERC20_ABI.balanceOf + walletAddress.slice(2).padStart(64, "0");

  // balance + decimals in parallel (decimals is usually a cache hit anyway)
  const [result, decimals] = await Promise.all([
    callEvmRpc(chain, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: tokenAddress, data: balanceOfData }, "latest"],
    }),
    getERC20Decimals(tokenAddress, chain),
  ]);

  const balance = BigInt(result || "0x0");
  return { balance: balance.toString(), decimals };
}

/**
 * Fetches ERC-20 token decimals
 * @param {string} tokenAddress - Token contract address
 * @param {Object} chain - Chain configuration
 * @returns {Promise<number>} Token decimals
 */
// decimals() is an immutable contract constant — cache it forever. This halves
// the RPC calls for tracked tokens on every refresh. Only VERIFIED values are
// cached: a transient RPC failure must not pin the default-18 fallback onto a
// 6-decimals token (which would skew its balance by 10^12 permanently).
const _decimalsCache = new Map(); // `${chainId}:${addressLower}` -> number

async function getERC20Decimals(tokenAddress, chain) {
  const key = `${chain.id}:${(tokenAddress || "").toLowerCase()}`;
  if (_decimalsCache.has(key)) return _decimalsCache.get(key);
  try {
    const result = await callEvmRpc(chain, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: tokenAddress, data: ERC20_ABI.decimals }, "latest"],
    }, 5000);
    const decimals = parseInt(result, 16);
    if (Number.isFinite(decimals) && decimals >= 0 && decimals <= 36) {
      _decimalsCache.set(key, decimals);
      return decimals;
    }
    return 18; // unparseable — use default but DON'T cache it
  } catch (error) {
    console.warn(`Failed to fetch token decimals, using default 18:`, error.message);
    return 18;
  }
}

// Binance public ticker for native-coin pricing — far more reliable from a
// server IP than CoinGecko's free API (which 429s constantly).
const BINANCE_SYMBOL = { ethereum: "ETHUSDT", binancecoin: "BNBUSDT" };

async function fetchBinancePrice(coingeckoId) {
  const sym = BINANCE_SYMBOL[coingeckoId];
  if (!sym) return 0;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, {
      headers: { accept: "application/json" }, signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) return 0;
    const data = await r.json();
    return parseFloat(data?.price) || 0;
  } catch {
    return 0;
  }
}

// Native-coin price cache: ETH price alone was being fetched twice per EVM
// wallet (ethereum + base) for every wallet in a refresh cycle — same number
// from the same endpoint. 60s TTL keeps a whole refresh-all on one fetch.
const _nativePriceCache = new Map(); // coingeckoId -> { price, ts }
const NATIVE_PRICE_TTL_MS = 60_000;

/**
 * Fetches a native-coin price in USD. Tries Binance first (reliable), then
 * falls back to CoinGecko. Returns 0 only if both fail.
 * @param {string} coingeckoId - CoinGecko token ID
 * @returns {Promise<number>} Token price in USD
 */
async function fetchTokenPrice(coingeckoId) {
  const cached = _nativePriceCache.get(coingeckoId);
  if (cached && Date.now() - cached.ts < NATIVE_PRICE_TTL_MS) return cached.price;

  const binance = await fetchBinancePrice(coingeckoId);
  if (binance > 0) {
    _nativePriceCache.set(coingeckoId, { price: binance, ts: Date.now() });
    return binance;
  }
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    
    // Use AbortController for proper timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`CoinGecko price fetch failed: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    const price = data?.[coingeckoId]?.usd || 0;
    if (price > 0) _nativePriceCache.set(coingeckoId, { price, ts: Date.now() });
    return price;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`CoinGecko price fetch timeout for ${coingeckoId}`);
    } else {
      console.warn(`Failed to fetch token price from CoinGecko:`, error.message);
    }
    return 0;
  }
}

/**
 * Converts EVM token data to dashboard format
 * @param {Array} tokens - Array of token holdings
 * @returns {Array} Formatted tokens for database storage
 */
export function convertToWalletTokens(tokens) {
  return tokens.map((token) => ({
    id: token.address === "native" ? token.symbol : token.address,
    address: token.address,
    symbol: token.symbol,
    units: token.balance,
    uiAmount: token.balance, // Also store as uiAmount for consistency
    decimals: token.decimals,
    value: token.value,
    price: token.price,
    chain: token.chain, // CRITICAL: Preserve chain field for multi-chain matching
    chainDisplay: token.chainDisplay, // Also preserve chain display name
  }));
}

/**
 * Gets supported chain names
 * @returns {Array<string>} List of supported chain names
 */
export function getSupportedChains() {
  return Object.keys(CHAINS);
}

/**
 * Gets chain configuration
 * @param {string} chainName - Chain name
 * @returns {Object|null} Chain configuration or null
 */
export function getChainConfig(chainName) {
  return CHAINS[chainName.toLowerCase()] || null;
}

/**
 * Validates EVM address format
 * @param {string} address - Address to validate
 * @returns {boolean} True if valid EVM address
 */
export function isValidEVMAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

