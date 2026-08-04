// MCP tool catalog for the in-process (Streamable HTTP) MCP server. Each tool's
// run(db, args) calls the shared portfolioState truth functions directly — the
// same ones /api/v1/portfolio and the dashboard use — so MCP, REST, and the UI
// can never disagree. Kept transport-agnostic so httpEndpoint.js just wires it up.
import {
  getFullState,
  getSummaryState,
  getWalletsState,
  getAssetsState,
  getExposureState,
  findPositions,
  getHistory,
} from '../services/portfolioState.js'

const EMPTY = { type: 'object', properties: {}, additionalProperties: false }

export const TOOLS = [
  {
    name: 'pulse_get_summary',
    description: 'Total and liquid net worth, crypto/bank split, 24h and 7d PnL, and the USD/EUR breakdown. Use for "what is my net worth?", "how much do I have liquid?", "what changed since yesterday?".',
    inputSchema: EMPTY,
    run: (db) => getSummaryState(db),
  },
  {
    name: 'pulse_get_wallets',
    description: 'Every wallet with its USD value, per-chain breakdown, and the tokens it holds. Use for "where is my money?" or "what is in my Ledger / Trading / Vault wallet?".',
    inputSchema: EMPTY,
    run: (db) => ({ wallets: getWalletsState(db) }),
  },
  {
    name: 'pulse_get_assets',
    description: 'Every token aggregated across all wallets: symbol, contract/mint, chain, amount, price, and USD value. Use for "what tokens do I hold?".',
    inputSchema: EMPTY,
    run: (db) => ({ assets: getAssetsState(db) }),
  },
  {
    name: 'pulse_get_exposure',
    description: 'Portfolio exposure as percentages — by token, by chain, by wallet, and by class (stable / liquid / illiquid). Use for "what am I overexposed to?".',
    inputSchema: EMPTY,
    run: (db) => getExposureState(db),
  },
  {
    name: 'pulse_get_position',
    description: 'Look up a single token by symbol (e.g. SOL) or contract/mint address: total amount, USD value, and which wallets hold it. Use for "how much ETH do I have?" or to find where a specific token is held across wallets.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Token symbol or contract/mint address' } },
      required: ['query'],
      additionalProperties: false,
    },
    run: (db, args) => findPositions(db, String(args.query || '')),
  },
  {
    name: 'pulse_get_history',
    description: 'Net-worth snapshots over a time range plus change and max-drawdown stats. Use for "how has my net worth moved this month?".',
    inputSchema: {
      type: 'object',
      properties: { range: { type: 'string', description: 'One of 7d, 14d, 30d, 90d, 180d, 1y, all (default 30d)' } },
      additionalProperties: false,
    },
    run: (db, args) => getHistory(db, args.range),
  },
  {
    name: 'pulse_get_portfolio',
    description: 'One-shot snapshot of the whole portfolio: summary plus every wallet (with assets) and the aggregated asset list. Use when you want everything in a single call.',
    inputSchema: EMPTY,
    run: (db) => getFullState(db),
  },
]
