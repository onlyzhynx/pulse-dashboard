# Pulse MCP server (stdio)

> **Most users don't need this.** The Pulse container already serves MCP over
> HTTP at `/mcp` — if your agent supports URL-based MCP servers, point it there
> (see [Agent connector → MCP](../README.md#mcp--built-into-the-same-container-mcp))
> and skip this package. This stdio server is the alternative for clients that
> launch an MCP server as a **subprocess** instead of connecting to a URL.

A read-only [MCP](https://modelcontextprotocol.io) server that exposes your Pulse
portfolio as tools an AI agent can call directly (`pulse_get_summary`,
`pulse_get_position`, …). It's a thin client over the bearer-authed
[`/api/v1/portfolio`](../README.md#agent-connector-read-only-api) REST connector —
it holds no logic of its own, so it can never disagree with the dashboard. No
signing, no wallet access, read-only.

## Setup

```bash
cd mcp
npm install
```

It needs two env vars (the same token you set on the Pulse server):

```
PULSE_API_URL=http://your-server:8787
PULSE_API_TOKEN=...
```

These can come from the MCP client's config (below) **or** from `~/.hermes/.env`
— the server reads that file for any var not already in its environment.

## Register it with an MCP client

Point your agent / MCP client at `node /path/to/pulse/mcp/index.js`. Generic
`mcpServers` config (Claude Desktop, Cursor, most clients):

```json
{
  "mcpServers": {
    "pulse": {
      "command": "node",
      "args": ["/absolute/path/to/pulse/mcp/index.js"],
      "env": {
        "PULSE_API_URL": "http://your-server:8787",
        "PULSE_API_TOKEN": "your-token"
      }
    }
  }
}
```

If you keep the token in `~/.hermes/.env`, you can omit the `env` block.

## Tools

| Tool | Answers |
|------|---------|
| `pulse_get_summary` | Net worth, liquid vs illiquid, 24h/7d PnL, USD/EUR |
| `pulse_get_wallets` | Per-wallet value, chain breakdown, holdings |
| `pulse_get_assets` | Every token: symbol, contract/mint, chain, amount, value |
| `pulse_get_exposure` | % by token / chain / wallet, stable·liquid·illiquid split |
| `pulse_get_position` | `{query}` — a token's amount, value, and which wallets hold it |
| `pulse_get_history` | `{range?}` — net-worth snapshots + drawdown/PnL stats |
| `pulse_get_portfolio` | Everything in one call (summary + wallets + assets) |

Each tool returns the connector's JSON verbatim. See the
[connector docs](../README.md#agent-connector-read-only-api) for field shapes and
the cost-basis / liquidity caveats.
