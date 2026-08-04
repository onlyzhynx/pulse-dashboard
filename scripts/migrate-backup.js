import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initSchema } from '../server/db/schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../data/pulse.db')

// Accept backup file as argument
const backupPath = process.argv[2]
if (!backupPath) {
  console.error('Usage: node scripts/migrate-backup.js <path-to-backup.json>')
  process.exit(1)
}

mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
initSchema(db)

const backup = JSON.parse(readFileSync(backupPath, 'utf-8'))

// ── Wallets ────────────────────────────────────────────────
const insWallet = db.prepare(`
  INSERT OR REPLACE INTO wallets (id, label, address, network, tags, source, position, fetch_strategy)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
let walletCount = 0
for (const w of backup.wallets || []) {
  insWallet.run(w.id, w.label, w.address, w.network, w.tags || '[]', w.source || 'user', w.position || 0, w.fetch_strategy || 'onchain')
  walletCount++
}
console.log(`v ${walletCount} wallets imported`)

// ── Portfolio snapshots ────────────────────────────────────
const existingSnapshots = db.prepare('SELECT COUNT(*) as c FROM portfolio_snapshots').get()
if (existingSnapshots.c === 0) {
  const insSnap = db.prepare('INSERT INTO portfolio_snapshots (captured_at, value) VALUES (?, ?)')
  const insertMany = db.transaction(snaps => snaps.forEach(s => insSnap.run(s.captured_at, s.value)))
  insertMany(backup.portfolio_snapshots || [])
  console.log(`v ${backup.portfolio_snapshots?.length || 0} portfolio snapshots imported`)
} else {
  console.log(`i Skipped snapshots - DB already has ${existingSnapshots.c} entries`)
}

// ── Cashout history ────────────────────────────────────────
const existingCashouts = db.prepare('SELECT COUNT(*) as c FROM cashout_history').get()
if (existingCashouts.c === 0) {
  const insCashout = db.prepare(`
    INSERT OR REPLACE INTO cashout_history (id, date, amount_usd, destination, notes, network, running_total_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMany = db.transaction(entries => entries.forEach(e =>
    insCashout.run(e.id, e.date, e.amount_usd, e.destination, e.notes, e.network, e.running_total_usd, e.created_at)
  ))
  insertMany(backup.cashout_history || [])
  console.log(`v ${backup.cashout_history?.length || 0} cashout entries imported`)
} else {
  console.log(`i Skipped cashouts - DB already has ${existingCashouts.c} entries`)
}

// ── Holdings universe ──────────────────────────────────────
const insHolding = db.prepare(`
  INSERT OR REPLACE INTO holdings_universe (id, symbol, name, network, address, coingecko_id, holdings_units, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
let holdingCount = 0
for (const h of backup.holdings_universe || []) {
  insHolding.run(h.id, h.symbol, h.name || h.symbol, h.network, h.address, h.coingecko_id, h.holdings_units || 0, h.source || 'user')
  holdingCount++
}
console.log(`v ${holdingCount} holdings imported`)

// ── Holdings selection ─────────────────────────────────────
const insSelection = db.prepare('INSERT OR REPLACE INTO holdings_selection (network, token_ids) VALUES (?, ?)')
for (const s of backup.holdings_selection || []) {
  insSelection.run(s.network, s.token_ids)
}
console.log(`v Holdings selection imported`)

console.log('\nMigration complete!')
console.log(`   DB: ${DB_PATH}`)
db.close()
