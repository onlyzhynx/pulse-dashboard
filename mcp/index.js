#!/usr/bin/env node
// Read-only MCP server for Pulse. Exposes the portfolio as MCP tools so an agent
// can call pulse_get_summary / pulse_get_position(...) etc. directly. It holds NO
// logic of its own — every tool is a thin GET against the bearer-authed REST
// connector (server/routes/connector.js), so Pulse stays the single source of
// truth and the MCP server can never disagree with the dashboard.
//
// Config (env, or ~/.hermes/.env as a fallback):
//   PULSE_API_URL    e.g. http://your-server:8787   (default http://localhost:8787)
//   PULSE_API_TOKEN  the same token set on the Pulse server
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ── Config ───────────────────────────────────────────────────────────────────
// Most MCP clients pass env through their config. As a convenience for the user's
// setup, also read ~/.hermes/.env for any var not already in the environment.
function loadHermesEnv() {
  try {
    const txt = readFileSync(join(homedir(), '.hermes', '.env'), 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!m) continue
      const key = m[1]
      const val = m[2].trim().replace(/^["']|["']$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* no ~/.hermes/.env — rely on the process environment */ }
}
loadHermesEnv()

const API_URL = (process.env.PULSE_API_URL || 'http://localhost:8787').replace(/\/+$/, '')
const API_TOKEN = process.env.PULSE_API_TOKEN || ''

// ── REST client ──────────────────────────────────────────────────────────────
async function pulseGet(path) {
  if (!API_TOKEN) throw new Error('PULSE_API_TOKEN is not set — put it in the MCP client env or ~/.hermes/.env')
  const res = await fetch(`${API_URL}/api/v1/portfolio${path}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Pulse API ${res.status}: ${text.slice(0, 300)}`)
  return text   // response is already JSON — pass it through verbatim
}

// ── Tool catalog ─────────────────────────────────────────────────────────────
// `path(args)` builds the REST path; everything else is the MCP tool spec.
const TOOLS = [
  {
    name: 'pulse_get_summary',
    description: 'Total and liquid net worth, crypto/bank split, 24h and 7d PnL, and the USD/EUR breakdown. Use for "what is my net worth?", "how much do I have liquid?", "what changed since yesterday?".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    path: () => '/summary',
  },
  {
    name: 'pulse_get_wallets',
    description: 'Every wallet with its USD value, per-chain breakdown, and the tokens it holds. Use for "where is my money?" or "what is in my Ledger / Trading / Vault wallet?".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    path: () => '/wallets',
  },
  {
    name: 'pulse_get_assets',
    description: 'Every token aggregated across all wallets: symbol, contract/mint, chain, amount, price, and USD value. Use for "what tokens do I hold?".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    path: () => '/assets',
  },
  {
    name: 'pulse_get_exposure',
    description: 'Portfolio exposure as percentages — by token, by chain, by wallet, and by class (stable / liquid / illiquid). Use for "what am I overexposed to?".',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    path: () => '/exposure',
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
    path: (args) => `/positions/${encodeURIComponent(args.query)}`,
  },
  {
    name: 'pulse_get_history',
    description: 'Net-worth snapshots over a time range plus change and max-drawdown stats. Use for "how has my net worth moved this month?".',
    inputSchema: {
      type: 'object',
      properties: { range: { type: 'string', description: 'One of 7d, 14d, 30d, 90d, 180d, 1y, all (default 30d)' } },
      additionalProperties: false,
    },
    path: (args) => `/history${args.range ? `?range=${encodeURIComponent(args.range)}` : ''}`,
  },
  {
    name: 'pulse_get_portfolio',
    description: 'One-shot snapshot of the whole portfolio: summary plus every wallet (with assets) and the aggregated asset list. Use when you want everything in a single call.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    path: () => '',
  },
]

const byName = new Map(TOOLS.map(t => [t.name, t]))

// ── Server ───────────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'pulse', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = byName.get(req.params.name)
  if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }] }
  try {
    const json = await pulseGet(tool.path(req.params.arguments || {}))
    return { content: [{ type: 'text', text: json }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] }
  }
})

await server.connect(new StdioServerTransport())
// stdout is the JSON-RPC channel — logs MUST go to stderr.
console.error(`pulse-mcp connected → ${API_URL}/api/v1/portfolio`)
