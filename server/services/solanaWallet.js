import fetch from "node-fetch";
import Big from "bignumber.js";
import {
  fetchTokenPrices as fetchTokenPricesFromGeckoTerminal,
  fetchSolPrice as fetchSolPriceFromGeckoTerminal,
  findTokenByAddress,
} from "./geckoTerminalApi.js";
import { fetchHoldings as fetchJupiterHoldings, fetchPrices as fetchJupiterPrices, fetchPositions as fetchJupiterPositions, getTokenMap } from "./jupiterApi.js";
import { applyDexFallback, verifyPricesAgainstLiquidity } from "./dexScreenerApi.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const LAMPORTS_PER_SOL = 1e9;
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
/** RPC fallback: use Helius first (when URL provided), then Solana mainnet-beta public RPC */
const SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

/**
 * Fetches Solana wallet holdings (SOL + SPL tokens) and computes total USD value.
 * Uses Jupiter API when jupiterApiKey is provided (Ultra Holdings + Price), else Helius/RPC + GeckoTerminal.
 * @param {string} walletAddress - Solana wallet public key
 * @param {string} heliusApiKey - Helius API key (optional)
 * @param {string} heliusRpcUrl - Helius RPC URL (optional)
 * @param {{ jupiterApiKey?: string }} [opts] - Optional. jupiterApiKey: use Jupiter Ultra Holdings + Price API
 * @returns {Promise<{totalValue: number, tokens: Array, solBalance: number}>}
 */
export async function fetchSolanaWalletValue(walletAddress, heliusApiKey, heliusRpcUrl, opts = {}) {
  const jupiterApiKey = opts?.jupiterApiKey;

  if (jupiterApiKey) {
    try {
      return await fetchSolanaWalletValueViaJupiter(walletAddress, jupiterApiKey);
    } catch (err) {
      console.warn("Jupiter wallet fetch failed, falling back to RPC:", err.message);
    }
  }

  if (!heliusApiKey || !heliusRpcUrl) {
    console.log("No Helius API key configured, using public Solana RPC");
  }

  try {
    const [tokenAccounts, solBalance] = await Promise.all([
      getTokenAccounts(walletAddress, heliusApiKey, heliusRpcUrl),
      getSolBalance(walletAddress, heliusApiKey, heliusRpcUrl),
    ]);

    const tokens = normalizeTokenAccounts(tokenAccounts);
    // Include wrapped SOL in the price batch so we get SOL price in the same request
    const mints = [WRAPPED_SOL_MINT, ...tokens.map((t) => t.mint)];
    const priceMap = await fetchTokenPrices(mints);
    const solPrice = priceMap.get(WRAPPED_SOL_MINT.toLowerCase())?.price || await fetchSolPrice();
    const solValue = new Big(solBalance).times(solPrice);

    // Discover symbol/name for tokens missing from GeckoTerminal: CoinGecko → Helius DAS → RPC (Helius then mainnet-beta)
    const needMeta = tokens.filter((t) => !priceMap.get(t.mint.toLowerCase())?.symbol);
    const metaLimit = 8;
    const metaByMint = new Map();
    if (needMeta.length > 0) {
      const results = await Promise.all(
        needMeta.slice(0, metaLimit).map((t) =>
          fetchTokenMetadata(t.mint, heliusApiKey, heliusRpcUrl).then((m) => ({ mint: t.mint.toLowerCase(), meta: m }))
        )
      );
      results.forEach(({ mint, meta }) => {
        if (meta) metaByMint.set(mint, meta);
      });
    }

    const holdings = [];
    let totalTokenValue = new Big(0);

    for (const token of tokens) {
      const priceData = priceMap.get(token.mint.toLowerCase());
      const discovered = metaByMint.get(token.mint.toLowerCase());
      const price = priceData?.price || 0;
      const tokenValue = new Big(token.uiAmount).times(price);
      if (tokenValue.gt(0) || new Big(token.uiAmount).gt(0)) {
        holdings.push({
          mint: token.mint,
          symbol: priceData?.symbol || discovered?.symbol || null,
          name: priceData?.name || discovered?.name || null,
          amount: token.amount.toString(),
          decimals: token.decimals,
          uiAmount: parseFloat(token.uiAmount),
          units: parseFloat(token.uiAmount),
          price,
          value: tokenValue.toNumber(),
        });
        totalTokenValue = totalTokenValue.plus(tokenValue);
      }
    }

    holdings.unshift({
      mint: WRAPPED_SOL_MINT,
      symbol: "SOL",
      amount: Math.floor(solBalance * LAMPORTS_PER_SOL).toString(),
      decimals: 9,
      uiAmount: solBalance,
      price: solPrice,
      value: solValue.toNumber(),
    });

    // Last-resort pricing for memecoins Jupiter/GeckoTerminal couldn't price,
    // then cross-verify every significant position against liquidity-verified
    // pools — bogus upstream prices get replaced or zeroed (priceRejected).
    await applyDexFallback(holdings, { skipMint: WRAPPED_SOL_MINT });
    await verifyPricesAgainstLiquidity(holdings, { skipMint: WRAPPED_SOL_MINT });

    // Recompute from the rows — both passes may have adjusted prices/values.
    const totalValue = holdings.reduce((s, h) => s + (Number(h.value) || 0), 0);
    return {
      totalValue,
      tokens: holdings,
      solBalance,
    };
  } catch (error) {
    console.error("Failed to fetch Solana wallet value:", error);
    throw error;
  }
}

/**
 * Fetch wallet value using Jupiter Ultra Holdings + Price API.
 * Uses Jupiter token list for symbol/name resolution (free, no auth).
 * @see https://dev.jup.ag/docs/ultra/get-holdings
 * @see https://dev.jup.ag/docs/price/v3
 */
async function fetchSolanaWalletValueViaJupiter(walletAddress, apiKey) {
  const [holdingsRes, positionsRes, tokenMap] = await Promise.all([
    fetchJupiterHoldings(walletAddress, apiKey),
    fetchJupiterPositions(walletAddress, apiKey).catch(() => ({ totalValue: 0, positions: [] })),
    getTokenMap().catch(() => new Map()),
  ]);

  const { nativeSol, tokens: jupiterTokens } = holdingsRes;
  const solBalance = nativeSol;

  const mints = [
    WRAPPED_SOL_MINT,
    ...jupiterTokens.map((t) => t.mint),
  ];
  // fetchPrices now returns Map<mintLower, {price, priceChange24h, decimals}>
  const priceMap = await fetchJupiterPrices(mints, apiKey);
  const solPriceData = priceMap.get(WRAPPED_SOL_MINT.toLowerCase());
  const solPrice = solPriceData?.price || 0;

  const holdings = [];
  let totalTokenValue = new Big(0);

  for (const token of jupiterTokens) {
    const mintLower = token.mint.toLowerCase();
    const priceData = priceMap.get(mintLower);
    const price = priceData?.price || 0;
    const meta = tokenMap.get(mintLower);
    const uiAmount = Number(token.uiAmount) || 0;
    const tokenValue = new Big(uiAmount).times(price);
    holdings.push({
      mint: token.mint,
      symbol: meta?.symbol || null,
      name: meta?.name || null,
      amount: token.amount || "0",
      decimals: token.decimals ?? 9,
      uiAmount,
      units: uiAmount,
      price,
      value: tokenValue.toNumber(),
    });
    totalTokenValue = totalTokenValue.plus(tokenValue);
  }

  const solValue = new Big(solBalance).times(solPrice);
  holdings.unshift({
    mint: WRAPPED_SOL_MINT,
    symbol: "SOL",
    amount: Math.floor(solBalance * LAMPORTS_PER_SOL).toString(),
    decimals: 9,
    uiAmount: solBalance,
    price: solPrice,
    value: solValue.toNumber(),
  });

  // Last-resort pricing for memecoins Jupiter couldn't price, then cross-verify
  // every significant position against liquidity-verified pools — a bogus
  // Jupiter price (manipulated micro-pool) gets replaced or zeroed here.
  await applyDexFallback(holdings, { skipMint: WRAPPED_SOL_MINT });
  await verifyPricesAgainstLiquidity(holdings, { skipMint: WRAPPED_SOL_MINT });

  // Recompute from the rows — both passes may have adjusted prices/values.
  let totalValue = holdings.reduce((s, h) => s + (Number(h.value) || 0), 0);
  const positionsValue = Number(positionsRes.totalValue) || 0;
  if (positionsValue > 0) {
    totalValue += positionsValue;
  }

  return {
    totalValue,
    tokens: holdings,
    solBalance,
  };
}

/**
 * Fetches all SPL token accounts for a wallet
 */
async function getTokenAccounts(walletAddress, heliusApiKey, heliusRpcUrl) {
  // Query BOTH the legacy SPL Token program and Token-2022 (many newer memecoins
  // use Token-2022), then merge — otherwise Token-2022 holdings are invisible.
  const fetchFor = async (programId) => {
    const params = [
      walletAddress,
      { programId },
      { encoding: "jsonParsed", commitment: "finalized" },
    ];
    const data = await callRpcWithFallback("getTokenAccountsByOwner", params, heliusApiKey, heliusRpcUrl);
    return data.result?.value || [];
  };
  // Don't swallow RPC failures: if BOTH program queries fail (e.g. rate limit),
  // throw so the caller treats it as a failed refresh and keeps the old value —
  // instead of silently reporting an empty wallet ($0).
  const settled = await Promise.allSettled([
    fetchFor(TOKEN_PROGRAM_ID),
    fetchFor(TOKEN_2022_PROGRAM_ID),
  ]);
  const ok = settled.filter(s => s.status === "fulfilled");
  if (ok.length === 0) {
    throw new Error(`getTokenAccounts failed: ${settled.map(s => s.reason?.message).join("; ")}`);
  }
  if (settled.some(s => s.status === "rejected")) {
    console.warn(`getTokenAccounts: one program query failed (${walletAddress.slice(0, 6)}…), using partial result`);
  }
  return ok.flatMap(s => s.value);
}

/**
 * Fetches SOL balance for a wallet
 */
async function getSolBalance(walletAddress, heliusApiKey, heliusRpcUrl) {
  const params = [walletAddress, { commitment: "finalized" }];
  const data = await callRpcWithFallback("getBalance", params, heliusApiKey, heliusRpcUrl);
  const lamports = data.result?.value || 0;
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Normalizes token account data to a standard format
 */
function normalizeTokenAccounts(accounts) {
  return accounts.map((account) => {
    const info = account.account.data.parsed.info;
    const tokenAmount = info.tokenAmount;
    
    return {
      mint: info.mint,
      owner: info.owner,
      amount: new Big(tokenAmount.amount),
      decimals: tokenAmount.decimals,
      uiAmount: new Big(tokenAmount.amount)
        .div(new Big(10).pow(tokenAmount.decimals))
        .toString(),
    };
  });
}

/**
 * Fetches USD prices for SPL tokens from GeckoTerminal API
 */
async function fetchTokenPrices(mints) {
  return await fetchTokenPricesFromGeckoTerminal(mints);
}

/**
 * Fetches SOL price from GeckoTerminal API
 */
async function fetchSolPrice() {
  return await fetchSolPriceFromGeckoTerminal();
}

/**
 * Helper function to sleep for a given duration
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Converts raw token data to the format expected by the dashboard
 * @param {Array} tokens - Array of token holdings from fetchSolanaWalletValue
 * @param {Object} coingeckoIdMap - Map of mint address to CoinGecko ID
 * @returns {Array} - Formatted tokens for database storage
 */
export function convertToWalletTokens(tokens, coingeckoIdMap = new Map()) {
  return tokens.map((token) => {
    // Try to find CoinGecko ID
    const coingeckoId = coingeckoIdMap.get(token.mint.toLowerCase());
    
    return {
      id: coingeckoId || token.mint,
      mint: token.mint,
      symbol: token.symbol || "UNKNOWN",
      units: token.uiAmount,
      decimals: token.decimals,
      value: token.value,
      price: token.price,
    };
  });
}

/**
 * Fetches token metadata via RPC (Helius then mainnet-beta fallback).
 * Mint account only has decimals; symbol/name use address prefix unless from Helius DAS earlier.
 */
async function fetchTokenMetadataViaRPC(mintAddress, heliusApiKey, heliusRpcUrl) {
  try {
    const data = await callRpcWithFallback(
      "getAccountInfo",
      [mintAddress, { encoding: "jsonParsed" }],
      heliusApiKey,
      heliusRpcUrl
    );
    if (!data?.result?.value) return null;
    const accountData = data.result.value.data;
    const decimals = accountData?.parsed?.info?.decimals ?? 9;
    return {
      symbol: mintAddress.slice(0, 6).toUpperCase(),
      name: `Token ${mintAddress.slice(0, 8)}`,
      decimals,
      logoUri: null,
    };
  } catch (error) {
    console.warn("RPC getAccountInfo for mint failed:", error.message);
    return null;
  }
}

/**
 * Fetches token info from CoinGecko by contract address
 * @param {string} mintAddress - Solana token mint address
 * @returns {Promise<{id: string, symbol: string, name: string, image: string}|null>}
 */
async function fetchTokenFromCoinGecko(mintAddress) {
  try {
    // CoinGecko search by contract address on Solana
    const cgController = new AbortController()
    const cgTimeout = setTimeout(() => cgController.abort(), 8000)
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/solana/contract/${mintAddress}`,
      { headers: { accept: "application/json" }, signal: cgController.signal }
    )
    clearTimeout(cgTimeout)

    if (!response.ok) {
      // Token not found on CoinGecko
      return null;
    }

    const data = await response.json();
    
    if (!data || !data.id) {
      return null;
    }
    
    return {
      id: data.id,
      symbol: data.symbol?.toUpperCase() || "UNKNOWN",
      name: data.name || "Unknown Token",
      image: data.image?.small || data.image?.thumb || null,
    };
  } catch (error) {
    console.warn("Failed to fetch from CoinGecko:", error.message);
    return null;
  }
}

/**
 * Fetches token metadata: CoinGecko → Helius DAS → RPC (Helius then mainnet-beta).
 * @param {string} mintAddress - Token mint address
 * @param {string} [heliusApiKey] - Helius API key
 * @param {string} [heliusRpcUrl] - Helius RPC URL (for RPC fallback chain)
 */
export async function fetchTokenMetadata(mintAddress, heliusApiKey, heliusRpcUrl) {
  const coingeckoData = await fetchTokenFromCoinGecko(mintAddress);
  if (coingeckoData) {
    return {
      symbol: coingeckoData.symbol,
      name: coingeckoData.name,
      decimals: 9,
      logoUri: coingeckoData.image,
      coingeckoId: coingeckoData.id,
    };
  }

  if (heliusApiKey) {
    try {
      const response = await fetch(
        `https://api.helius.xyz/v0/token-metadata?api-key=${heliusApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mintAccounts: [mintAddress] }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        if (data?.[0]) {
          const m = data[0];
          return {
            symbol: m.symbol || "UNKNOWN",
            name: m.name || "Unknown Token",
            decimals: m.decimals ?? 9,
            logoUri: m.logoURI || null,
            coingeckoId: null,
          };
        }
      }
      if (response.status === 429) {
        const rpcData = await fetchTokenMetadataViaRPC(mintAddress, heliusApiKey, heliusRpcUrl);
        return rpcData ? { ...rpcData, coingeckoId: null } : null;
      }
    } catch (error) {
      console.warn("Helius token-metadata failed:", error.message);
    }
  }

  const rpcData = await fetchTokenMetadataViaRPC(mintAddress, heliusApiKey, heliusRpcUrl);
  return rpcData ? { ...rpcData, coingeckoId: null } : null;
}

/**
 * Searches CoinGecko for a token by contract address to find its ID
 * @param {string} mintAddress - Solana token mint address
 * @returns {Promise<string|null>} - CoinGecko ID or null if not found
 */
export async function findCoinGeckoId(mintAddress) {
  try {
    // CoinGecko search by contract address on Solana
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/solana/contract/${mintAddress}`,
      {
        headers: {
          accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      // Token not found on CoinGecko
      return null;
    }

    const data = await response.json();
    return data?.id || null;
  } catch (error) {
    console.warn("Failed to find CoinGecko ID:", error.message);
    return null;
  }
}

// ── Global RPC throttle ──────────────────────────────────────────────
// Cap concurrent RPC calls so we don't burst past the endpoint's rate limit
// (which was intermittently 429-ing wallets). Calls beyond the cap queue.
const RPC_MAX_CONCURRENT = parseInt(process.env.SOLANA_RPC_CONCURRENCY || '3', 10)
let _rpcActive = 0
const _rpcQueue = []
function _rpcAcquire() {
  if (_rpcActive < RPC_MAX_CONCURRENT) { _rpcActive++; return Promise.resolve() }
  return new Promise(resolve => _rpcQueue.push(resolve))
}
function _rpcRelease() {
  _rpcActive--
  const next = _rpcQueue.shift()
  if (next) { _rpcActive++; next() }
}

/**
 * Call Solana RPC with fallback: Helius (if URL given) then mainnet-beta public API.
 * Use this for getTokenAccountsByOwner, getBalance, getAccountInfo, etc.
 */
async function callRpcWithFallback(method, params, heliusApiKey, heliusRpcUrl) {
  if (heliusRpcUrl) {
    const heliusResult = await callRpcEndpoint(method, params, heliusRpcUrl, heliusApiKey, true);
    if (heliusResult !== null) return heliusResult;
  }
  const publicResult = await callRpcEndpoint(method, params, SOLANA_PUBLIC_RPC, null, false);
  if (publicResult === null) throw new Error("Solana RPC failed (Helius and mainnet-beta)");
  return publicResult;
}

async function callRpcEndpoint(method, params, endpoint, apiKey, isHelius) {
  await _rpcAcquire()
  const MAX_ATTEMPTS = 4
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 12000)
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          signal: controller.signal,
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        })
        clearTimeout(timeoutId)

        // Rate-limited → exponential backoff and retry before giving up
        if (response.status === 429) {
          if (attempt < MAX_ATTEMPTS) { await sleep(400 * 2 ** (attempt - 1)); continue }
          if (isHelius) { console.warn("Helius RPC rate-limited after retries; falling back to public RPC."); return null }
          throw new Error("Solana RPC rate limit exceeded")
        }
        if (!response.ok) throw new Error(`RPC request failed (${response.status})`)

        const data = await response.json()
        if (data.error) throw new Error(data.error.message || "RPC error")
        return data
      } catch (error) {
        // Retry transient network/timeout errors too
        const transient = /abort|fetch failed|ECONNRESET|ETIMEDOUT|socket|network|EAI_AGAIN/i.test(error.message || "")
        if (transient && attempt < MAX_ATTEMPTS) { await sleep(400 * 2 ** (attempt - 1)); continue }
        if (isHelius) { console.warn(`Helius RPC error: ${error.message}`); return null }
        throw error
      }
    }
    if (isHelius) return null
    throw new Error("Solana RPC failed after retries")
  } finally {
    _rpcRelease()
  }
}
