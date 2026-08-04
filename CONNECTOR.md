# Pulse Connector — read-only portfolio API

The connector exposes Pulse's portfolio state to external tools (an AI agent like
Hermes, a cron job, a script) in three interchangeable forms, all backed by the
**same data** and the **same bearer token**:

| Form | Endpoint | Use it when… |
|------|----------|--------------|
| **REST** | `GET /api/v1/portfolio/*` | A script or cron wants plain HTTP/JSON. |
| **MCP over HTTP** | `POST /mcp` | An agent supports URL-based MCP servers (all-in-one with Docker). |
| **MCP over stdio** | [`mcp/`](./mcp/README.md) package | An agent only spawns MCP servers as a subprocess. |

Everything is **read-only** (GET / tool calls only — no signing, no wallet access,
no writes) and derives from the same truth functions the dashboard uses
(`computeCryptoUsd` / `computeBankUsd` in [portfolioSnapshot.js](server/services/portfolioSnapshot.js),
holdings aggregation in [portfolioState.js](server/services/portfolioState.js)), so
the connector can never disagree with the UI.

---

## 1. Security model

- **Separate from the dashboard session.** The UI uses a cookie/password session
  ([middleware/auth.js](server/middleware/auth.js)); the connector uses a static
  bearer token ([middleware/bearerAuth.js](server/middleware/bearerAuth.js)). No
  cookie, no CSRF surface, no session bleed.
- **Fails closed.** If `PULSE_API_TOKEN` is unset in the server environment, every
  connector request returns **503 "Connector disabled"** — it is never open by
  accident.
- **Constant-time token compare**, so the token can't be guessed by timing.
- **Read-only.** There is deliberately no write/refresh route under the connector.

---

## 2. Enabling it (server setup)

The connector and MCP endpoint are live only when `PULSE_API_TOKEN` is present
**inside the container**. Two pieces are required:

1. **`PULSE_API_TOKEN` in the server `.env`** (the docker-compose project dir, e.g.
   `~/Projects/pulse/.env`):
   ```bash
   echo "PULSE_API_TOKEN=$(openssl rand -hex 32)" >> .env
   ```
2. **The compose passthrough** — [docker-compose.yml](docker-compose.yml) forwards
   it into the container:
   ```yaml
   environment:
     PULSE_API_TOKEN: ${PULSE_API_TOKEN:-}
   ```

> **Env-passthrough trap:** compose's `environment:` block is an allowlist — a new
> key in `.env` does nothing until it's also listed there. And editing `.env` does
> not reach a running container; you must recreate it:
> ```bash
> docker compose up -d --force-recreate pulse
> docker compose exec -T pulse printenv PULSE_API_TOKEN   # must print the token
> ```

Standard deploy (`bash update.sh` → `git pull` + `docker compose up -d --build`)
applies code changes; the token still has to be in `.env` and the container
recreated.

---

## 3. Authentication

Every request carries the token as a bearer header (the connector also accepts
`X-API-Key`):

```
Authorization: Bearer <PULSE_API_TOKEN>
```

| Response | Meaning |
|----------|---------|
| `200` + JSON | OK |
| `401 {"error":"Unauthorized"}` | Missing/wrong token |
| `503 {"error":"Connector disabled..."}` | `PULSE_API_TOKEN` not set in the container env (see §2) |

---

## 4. REST API reference

Base path: `/api/v1/portfolio` (defined in [routes/connector.js](server/routes/connector.js)).
All examples assume `BASE=http://your-server:8787` and a `Bearer` header.

### `GET /api/v1/portfolio/summary`
Net worth, liquid split, PnL, and FX breakdown.
```json
{
  "updated_at": "2026-06-29T12:00:00Z",
  "net_worth_usd": 21074.69,
  "crypto_usd": 19074.69,
  "bank_usd": 2000,
  "bank_eur": 1737.19,
  "liquid_usd": 11852.48,
  "stable_usd": 4000,
  "illiquid_usd": 7222.21,
  "delta_24h_usd": 1074.69,
  "delta_24h_pct": 5.37,
  "delta_7d_usd": 1074.69,
  "delta_7d_pct": 5.37,
  "currency": { "USD": 21074.69, "EUR": 19388.71 },
  "rates": { "USD": 1, "EUR": 0.92 }
}
```
- `liquid_usd` = stablecoins + bluechips (spendable without selling core bags).
- Deltas compare current net worth to the nearest snapshot ~24h / ~7d ago.

### `GET /api/v1/portfolio/wallets`
Per-wallet value, chain breakdown, and the tokens each holds.
```json
{
  "wallets": [
    {
      "id": "sol1",
      "name": "Trading",
      "address": "So1tradingaddr",
      "network": "Solana",
      "value_usd": 4074.69,
      "token_count": 2,
      "last_refreshed": "2026-06-29T11:00:00Z",
      "tags": ["hot"],
      "side": false,
      "chains": [{ "chain": "solana", "value_usd": 4074.69 }],
      "assets": [
        { "symbol": "ALT", "name": "Alt Token", "chain": "solana", "contract": "altmint1111111111111111111111111111111111111",
          "amount": 123456, "price_usd": 0.018, "value_usd": 2222.21,
          "token_key": "solana_altmint1111111111111111111111111111111111111", "class": "illiquid", "blacklisted": 0 }
      ]
    }
  ]
}
```
- A single `"EVM"` wallet can hold tokens on multiple chains — `chains[]` and each
  asset's `chain` reflect the real network (derived from `token_key`).
- `value_usd` already excludes blacklisted tokens; assets list them with
  `blacklisted: 1` so the sum may exceed `value_usd`.

### `GET /api/v1/portfolio/assets`
Every token aggregated across all wallets (matches the Holdings list).
```json
{
  "assets": [
    { "symbol": "ETH", "name": "Ethereum", "chain": "ethereum", "contract": null,
      "amount": 2, "price_usd": 3000, "value_usd": 6000, "token_key": "ethereum_native",
      "wallet_count": 1, "class": "liquid", "blacklisted": 0,
      "price_source": null, "liquidity_usd": null }
  ]
}
```
- `contract` is the EVM contract or Solana mint; `null`/empty for native gas tokens.
- `price_source` and `liquidity_usd` are `null` — Pulse doesn't persist them.

### `GET /api/v1/portfolio/exposure`
Concentration as percentages of crypto net worth (`basis_usd`).
```json
{
  "basis_usd": 19074.69,
  "by_token":  [{ "symbol": "ETH", "chain": "ethereum", "token_key": "ethereum_native", "value_usd": 6000, "pct": 31.46 }],
  "by_chain":  [{ "chain": "ethereum", "value_usd": 6000, "pct": 31.46 }],
  "by_wallet": [{ "name": "Ledger", "value_usd": 10000, "pct": 52.43 }],
  "by_class":  {
    "stable":   { "value_usd": 4000,    "pct": 20.97 },
    "liquid":   { "value_usd": 7852.48, "pct": 41.17 },
    "illiquid": { "value_usd": 7222.21, "pct": 37.86 }
  }
}
```
- Blacklisted tokens are excluded. Value-only wallets (no per-token rows) appear in
  `by_chain` / `by_wallet` and count as `illiquid` in `by_class`.

### `GET /api/v1/portfolio/positions/{symbol-or-contract}`
Locate a token by symbol (fuzzy) or contract/mint (exact).
```json
{
  "query": "ALT",
  "matches": [
    {
      "token_key": "solana_altmint1111111111111111111111111111111111111",
      "symbol": "ALT", "name": "Alt Token", "chain": "solana", "contract": "altmint1111111111111111111111111111111111111",
      "price_usd": 0.018, "amount": 123456, "value_usd": 2222.21, "blacklisted": 0,
      "cost_basis_usd": null, "unrealized_pnl_usd": null,
      "locations": [{ "wallet": "Trading", "wallet_id": "sol1", "amount": 123456, "value_usd": 2222.21 }]
    }
  ]
}
```
- `cost_basis_usd` / `unrealized_pnl_usd` are always `null` (see §6).

### `GET /api/v1/portfolio/history?range=30d`
Net-worth snapshots + change/drawdown stats. `range` ∈ `7d, 14d, 30d, 90d, 180d, 1y, all` (default `30d`).
```json
{
  "range": "7d",
  "days": 7,
  "snapshots": [{ "captured_at": "2026-06-22T12:00:00Z", "value_usd": 18000 }],
  "stats": {
    "first": 18000, "last": 22000, "min": 18000, "max": 23000,
    "change_usd": 4000, "change_pct": 22.22, "max_drawdown_pct": -4.35, "points": 4
  }
}
```

### `GET /api/v1/portfolio`
One-shot blob: `{ updated_at, net_worth_usd, summary, wallets, assets }` — `summary`,
`wallets`, and `assets` are the same objects as the routes above.

---

## 5. MCP

The same data is exposed as MCP tools. Tool names and what they answer:

| Tool | Args | Answers |
|------|------|---------|
| `pulse_get_summary` | — | net worth, liquid vs illiquid, 24h/7d PnL, USD/EUR |
| `pulse_get_wallets` | — | per-wallet value, chain breakdown, holdings |
| `pulse_get_assets` | — | every token: symbol, contract/mint, chain, amount, value |
| `pulse_get_exposure` | — | % by token / chain / wallet, stable·liquid·illiquid |
| `pulse_get_position` | `query` | a token's amount, value, and which wallets hold it |
| `pulse_get_history` | `range?` | net-worth snapshots + drawdown/PnL |
| `pulse_get_portfolio` | — | everything in one call |

### 5a. MCP over HTTP (`/mcp`) — built into the container

Served in-process by the Express app ([server/mcp/httpEndpoint.js](server/mcp/httpEndpoint.js)
+ [tools.js](server/mcp/tools.js)) over **Streamable HTTP**, stateless, behind the
same bearer auth. No extra service to run.

Smoke test (raw JSON-RPC; a real client handles the SSE framing automatically):
```bash
curl -s -X POST $BASE/mcp \
  -H "Authorization: Bearer $PULSE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 5b. MCP over stdio — [`mcp/`](./mcp/README.md) package

A self-contained Node package the client launches as a subprocess; it calls the
REST connector over HTTP. Its `@modelcontextprotocol/sdk` dependency lives only in
`mcp/`, so it never enters the Docker image. See [mcp/README.md](./mcp/README.md).

---

## 6. Data-model notes & caveats

- **`token_key`** = `"<chain>_<addr>"` (e.g. `solana_<mint>`, `base_native`). The
  chain prefix is the source of truth for which network a holding is on.
- **No spot cost basis.** Pulse stores no cost basis for spot tokens, so
  `cost_basis_usd` / `unrealized_pnl_usd` are always `null`. Portfolio-level PnL is
  available via `summary` deltas and `history`.
- **liquid/illiquid is a heuristic** on the symbol: stablecoins (`USDC`, `USDT`, …)
  → `stable`; bluechips (`BTC`, `ETH`, `SOL`, `BNB`, wrapped/staked variants) →
  `liquid`; everything else → `illiquid`. A value-only wallet (a source that returns
  only a total, no token breakdown) counts as `illiquid`.
- **Blacklist.** Tokens on the holdings blacklist are excluded from totals and
  exposure (matching net worth) but still listed in `assets`/`wallets` with
  `blacklisted: 1`.
- **Currency.** `EUR` is derived from the latest cached FX rate (`rates`).

---

## 7. Connecting an agent (e.g. Hermes)

Consumer config in `~/.hermes/.env` (used by the stdio package, and handy for any
script):
```
PULSE_API_URL=http://your-server:8787
PULSE_API_TOKEN=...
```

**URL-based MCP client** (agent and Pulse on the same box → `localhost`):
```json
{
  "mcpServers": {
    "pulse": {
      "url": "http://localhost:8787/mcp",
      "headers": { "Authorization": "Bearer <PULSE_API_TOKEN>" }
    }
  }
}
```

**stdio MCP client** (spawns a subprocess):
```json
{
  "mcpServers": {
    "pulse": {
      "command": "node",
      "args": ["/absolute/path/to/pulse/mcp/index.js"],
      "env": { "PULSE_API_URL": "http://localhost:8787", "PULSE_API_TOKEN": "..." }
    }
  }
}
```

Restart the agent after editing its config so it loads the server.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `503 Connector disabled` | `PULSE_API_TOKEN` not in the container env. Add it to `.env`, confirm the compose passthrough, then `docker compose up -d --force-recreate pulse`. Verify with `docker compose exec -T pulse printenv PULSE_API_TOKEN`. |
| `401 Unauthorized` | Token in the request ≠ the server's `PULSE_API_TOKEN`. |
| Agent shows no `pulse_*` tools | Wrong config path/format, or (stdio) `node` not on PATH — use an absolute node path, or check the URL is reachable. |
| Tool calls error `fetch failed` (stdio) | `PULSE_API_URL` wrong for that host (`localhost` only works on the Pulse box). |
| Values look stale | The connector reads current DB state; refresh wallets in the dashboard. Net worth follows the same blacklist/enabled-wallet rules as the UI. |

---

## 9. Source map

| File | Responsibility |
|------|----------------|
| [server/middleware/bearerAuth.js](server/middleware/bearerAuth.js) | Bearer-token auth (fail-closed, constant-time) |
| [server/services/portfolioSnapshot.js](server/services/portfolioSnapshot.js) | Net-worth truth (`computeCryptoUsd`/`computeBankUsd`) |
| [server/services/portfolioState.js](server/services/portfolioState.js) | Normalized state + all response shapes |
| [server/routes/connector.js](server/routes/connector.js) | REST routes under `/api/v1/portfolio` |
| [server/mcp/tools.js](server/mcp/tools.js) | MCP tool catalog (calls portfolioState directly) |
| [server/mcp/httpEndpoint.js](server/mcp/httpEndpoint.js) | MCP over Streamable HTTP at `/mcp` |
| [mcp/](mcp/README.md) | Standalone stdio MCP server |
| [docker-compose.yml](docker-compose.yml) | `PULSE_API_TOKEN` env passthrough |
