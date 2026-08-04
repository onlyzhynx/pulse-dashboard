import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import SQLiteStore from 'better-sqlite3-session-store'
import cors from 'cors'
import compression from 'compression'
import morgan from 'morgan'
import { fileURLToPath } from 'url'
import path from 'path'
import { mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import { initSchema } from './db/schema.js'
import authRouter from './routes/auth.js'
import layoutRouter from './routes/layout.js'
import bankRouter from './routes/bank.js'
import networthRouter from './routes/networth.js'
import portfolioRouter from './routes/portfolio.js'
import cashoutRouter from './routes/cashout.js'
import walletsRouter from './routes/wallets.js'
import holdingsRouter from './routes/holdings.js'
import cryptoRouter from './routes/crypto.js'
import hyperliquidRouter from './routes/hyperliquid.js'
import meteoraRouter from './routes/meteora.js'
import currencyRouter from './routes/currency.js'
import dataRouter from './routes/data.js'
import connectorRouter from './routes/connector.js'
import mcpHttpHandler from './mcp/httpEndpoint.js'
import { requireBearer } from './middleware/bearerAuth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8787
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/pulse.db')

// ── Database ────────────────────────────────────────────────
mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
initSchema(db)

const SessionStore = SQLiteStore(session)

// ── App ─────────────────────────────────────────────────────
const app = express()

app.use(compression())  // gzip: ~70% smaller JS bundle + API JSON transfers
// Skip the Docker healthcheck (hits every 30s — pure log noise otherwise)
app.use(morgan('dev', { skip: (req) => req.path === '/api/health' }))
app.use(cors({ origin: true, credentials: true }))
// Default 100kb body limit 413s on real payloads: /api/data/import posts a
// full backup JSON in one request.
app.use(express.json({ limit: '25mb' }))
app.use(session({
  store: new SessionStore({ client: db }),
  secret: process.env.SESSION_SECRET || 'pulse-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}))

// ── Routes ──────────────────────────────────────────────────
app.use('/api/auth', authRouter)
app.use('/api/layout', layoutRouter(db))
app.use('/api/bank', bankRouter(db))
app.use('/api/networth', networthRouter(db))
app.use('/api/portfolio', portfolioRouter(db))
app.use('/api/cashout', cashoutRouter(db))
app.use('/api/wallets', walletsRouter(db))
app.use('/api/holdings', holdingsRouter(db))
app.use('/api/crypto', cryptoRouter(db))
app.use('/api/hyperliquid', hyperliquidRouter(db))
app.use('/api/meteora', meteoraRouter(db))
app.use('/api/currency', currencyRouter(db))
app.use('/api/data', dataRouter(db))

// Read-only agent connector (bearer-token auth, separate from the UI session).
// Disabled unless PULSE_API_TOKEN is set in the environment.
app.use('/api/v1/portfolio', connectorRouter(db))

// Same connector, exposed as MCP over Streamable HTTP — lets an agent call the
// portfolio tools natively at /mcp. Same bearer token, same single container.
app.all('/mcp', requireBearer, mcpHttpHandler(db))

app.get('/api/health', (req, res) => res.json({ ok: true, version: '2.0.0' }))

// ── Static (production) ─────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist')
  // Vite assets are content-hashed → cache forever. index.html keeps the
  // default ETag revalidation so deploys show up immediately.
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }))
  app.get('/*path', (req, res) => res.sendFile(path.join(distPath, 'index.html')))
}

app.listen(PORT, () => console.log(`Pulse v2 running on :${PORT}`))

// Portfolio snapshots are written from a single place (server/services/
// portfolioSnapshot.js) by the wallet auto-refresh (every 12h, clean refresh
// only) and on a force "refresh all" — so the history series stays consistent.
