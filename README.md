# Pulse

A self-hosted net-worth dashboard. It pulls your crypto wallet balances on-chain,
lets you track bank balances and spending by hand, and shows the combined picture
in one drag-and-drop grid.

Everything runs on your own machine or server. There is no hosted version, no
account, and nothing leaves your box except the public price/RPC calls needed to
value your tokens.

---

## Quick start (Docker — recommended)

```bash
git clone <this-repo-url> pulse
cd pulse
cp .env.example .env
```

Edit `.env` and set at minimum:

```
DASHBOARD_PASSWORD=something-long-and-private
SESSION_SECRET=<paste the output of: openssl rand -hex 32>
```

Then:

```bash
docker compose up -d --build
```

Open <http://localhost:8787> and log in with the password you set.

To update later:

```bash
git pull && docker compose up -d --build
```

## Quick start (local dev, no Docker)

```bash
npm install
cp .env.example .env      # set DASHBOARD_PASSWORD
npm run server            # terminal 1 — Express + SQLite on :8787
npm run dev               # terminal 2 — Vite dev server on :5173
```

Run the tests with `npm test`.

---

## First five minutes

1. **Log in** with your `DASHBOARD_PASSWORD`.
2. **Crypto tab → add a wallet.** Paste a Solana or EVM address. Balances and
   prices are fetched on demand; hit refresh to update.
3. **Home → Balances → +.** Add bank accounts manually (name, type, currency,
   balance). Pulse never connects to a bank — you type the number and update it
   whenever you like.
4. **Cashouts widget.** Log crypto-to-fiat withdrawals, optionally crediting a
   bank account at the same time.
5. **Drag the widgets around.** The layout is saved per device.

---

## What it tracks

| Widget | What it shows |
|--------|---------------|
| Net Worth | Crypto + bank total, 24h delta, breakdown pie |
| Crypto Ticker | Live BTC/ETH/SOL/BNB (and any Binance pair you add) over WebSocket |
| Portfolio History | Net worth over time, filterable by range |
| Wallets | On-chain Solana + EVM balances per wallet |
| Holdings | Every token across wallets, sortable by size/price/name |
| Balances | Manual bank accounts plus a crypto summary row |
| Cashouts | Crypto-to-fiat withdrawals, monthly chart, CSV export |
| Spending / Monthly / Yearly | Expenses by category and month, income vs outgoings |
| Recurring | Detects subscriptions from repeated transactions |
| Transactions | Searchable, filterable feed of everything |
| Hyperliquid / Meteora | Perps equity and LP positions, if you use them |

Tabs: **Home · Crypto · Transactions · Monthly · History**.
Themes: **Dark** and **Light**. The eye icon in the top bar blurs every number —
handy when screen sharing.

### Currencies

Every amount is stored in **USD**. The top-bar switch converts the display
between **USD** and **EUR** using a daily rate from
[frankfurter.app](https://frankfurter.app) (no API key needed). Bank accounts can
be denominated in either and are converted into the USD total.

### Bank data is manual

There is no bank connection and no statement import. You add accounts and
transactions yourself, or `POST` them to `/api/bank/transactions`. A transaction
posted without a category gets one guessed from its description — that keyword
list is at the top of [`server/routes/bank.js`](server/routes/bank.js) and is
meant to be edited to match where you actually shop.

---

## Configuration

Only the password is required. The full list, with comments, is in
[`.env.example`](.env.example).

| Variable | Default | Notes |
|----------|---------|-------|
| `DASHBOARD_PASSWORD` | `changeme` | **Change this.** It is the only credential. |
| `SESSION_SECRET` | auto | Random string for signing the session cookie |
| `PORT` | `8787` | Server port |
| `DATABASE_PATH` | `./data/pulse.db` | SQLite file location |
| `HELIUS_API_KEY` | — | Solana RPC, free at [helius.dev](https://helius.dev). Falls back to public RPC. |
| `JUPITER_API_KEY` | — | Solana prices, free at [portal.jup.ag](https://portal.jup.ag) |
| `WALLET_REFRESH_MINUTES` | `720` | Background refresh + snapshot interval. `0` disables it. |
| `PULSE_API_TOKEN` | — | Bearer token for the read-only API below. Unset = disabled. |

With no API keys at all the app still works — Solana falls back to public RPC,
which is slower and rate-limited. The two free keys are worth adding if you hold
more than a handful of tokens.

---

## Security notes

Read these before putting Pulse anywhere reachable from the internet.

- **One shared password, no user accounts.** Anyone with the password sees
  everything. Don't reuse a password from somewhere else.
- **Prefer keeping it private.** A home server, or a VPN /
  [Tailscale](https://tailscale.com) / Cloudflare Tunnel, is much safer than an
  open port. If you do expose it, put HTTPS in front — the session cookie is not
  worth sending in clear text.
- **The database is your actual net worth.** `data/pulse.db` is gitignored for a
  reason. Don't commit it, and think about where you back it up.
- **Never commit `.env`.** It holds your password and API keys. It is gitignored;
  keep it that way.
- **Wallet tracking is read-only.** Pulse only reads public chain data. It never
  asks for a seed phrase or private key and cannot move funds. If anything ever
  asks you for a private key, it isn't this app.

---

## Read-only API + MCP (optional)

Pulse can expose a bearer-token, **read-only** REST API at `/api/v1/portfolio/*`
so other tools (a script, an AI assistant) can read your portfolio. It is
disabled unless `PULSE_API_TOKEN` is set, and serves only `GET` routes.

```bash
echo "PULSE_API_TOKEN=$(openssl rand -hex 32)" >> .env
docker compose up -d
```

The same container also serves those tools over MCP at `/mcp`.
Full reference: [CONNECTOR.md](CONNECTOR.md).

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite, CSS variables for theming |
| Charts | Recharts |
| Backend | Express, routes split under `server/routes/` |
| Database | SQLite (better-sqlite3, WAL mode) |
| Auth | Password + signed session cookie |

```
server/
  index.js          # entry point
  db/schema.js      # SQLite schema
  middleware/       # auth (session), bearerAuth (API token)
  routes/           # auth, bank, cashout, crypto, holdings, wallets,
                    # networth, portfolio, currency, connector
  services/         # chain + price adapters, net-worth calculation
src/
  components/       # layout (Dashboard, TopBar, Widget) + widgets/
  context/          # Theme, Auth, Currency
scripts/
  migrate-backup.js # import a Pulse backup JSON into SQLite
data/               # pulse.db lives here (gitignored)
```

Net worth is computed in exactly one place — `computeNetWorthUsd()` in
[`server/services/portfolioSnapshot.js`](server/services/portfolioSnapshot.js).
Every widget and API route reads from it, so they cannot disagree. If you add
another way to total things up, route it through there.

---

## Troubleshooting

**A token shows $0 or an absurd value.** Thin-liquidity pools are filtered out on
purpose (the `DEXSCREENER_*` guards in `.env.example`). A token that can't be
priced safely stays unpriced rather than inventing a number.

**Balances swing between refreshes.** Public RPCs rate-limit. Add the free Helius
and Jupiter keys. Note that a refresh returning far less than the previous value
is rejected as suspect instead of being saved.

**Port 8787 is already in use.** Set `PORT` in `.env`.
