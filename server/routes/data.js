import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

export default function dataRouter(db) {
  const router = Router()
  router.use(requireAuth)

  // ── Export all data as JSON backup ───────────────────────
  router.get('/export', (req, res) => {
    try {
      const data = {
        version: '2.0.0',
        exported_at: new Date().toISOString(),
        wallets: db.prepare('SELECT * FROM wallets').all(),
        cashout_history: db.prepare('SELECT * FROM cashout_history ORDER BY date').all(),
        portfolio_snapshots: db.prepare('SELECT * FROM portfolio_snapshots ORDER BY captured_at').all(),
        bank_accounts: db.prepare('SELECT * FROM bank_accounts ORDER BY position').all(),
        bank_transactions: db.prepare('SELECT * FROM bank_transactions ORDER BY date').all(),
        holdings_universe: db.prepare('SELECT * FROM holdings_universe').all(),
        holdings_selection: db.prepare('SELECT * FROM holdings_selection').all(),
        major_selection: db.prepare('SELECT symbol FROM major_selection').all().map(r => r.symbol),
      }
      const filename = `pulse-backup-${new Date().toISOString().slice(0, 10)}.json`
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Content-Type', 'application/json')
      res.json(data)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // ── Import from JSON backup ───────────────────────────────
  // Handles:
  //   v1 (_pulse_export: true, _version: 1) — the old Pulse format
  //   v2 (version: '2.0.0')                 — current format
  router.post('/import', (req, res) => {
    try {
      const data = req.body

      // Accept v1 (_pulse_export) or v2 (version) or any file with known arrays
      const isValid = data && (
        data._pulse_export ||
        data.version ||
        data.wallets ||
        data.cashout_history ||
        data.portfolio_snapshots
      )
      if (!isValid) return res.status(400).json({ error: 'Invalid backup format' })

      // Cache actual column info per table so we can fill required columns
      // that the backup doesn't carry (e.g. user_id from old v1 schema).
      const tableColCache = {}
      const getTableCols = (table) => {
        if (!tableColCache[table]) {
          tableColCache[table] = db.prepare(`PRAGMA table_info(${table})`).all()
        }
        return tableColCache[table]
      }

      // Fallback values for columns that are NOT NULL but have no DEFAULT
      // and aren't present in the backup row.
      const FALLBACKS = {
        wallets: { user_id: 'default', enabled: 1 },
      }

      // INSERT OR REPLACE a plain row object into any table.
      // Detects NOT NULL columns missing from the row and fills them from
      // FALLBACKS so old backups (e.g. v1 with user_id) import cleanly.
      const insertRow = (table, row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return
        const cols = getTableCols(table)
        const colSet = new Set(cols.map(c => c.name))
        const filled = { ...row }

        // Fill any NOT NULL + no-default column that the backup row is missing
        for (const col of cols) {
          if (col.notnull && col.dflt_value === null && !(col.name in filled)) {
            const fallback = FALLBACKS[table]?.[col.name]
            if (fallback !== undefined) filled[col.name] = fallback
          }
        }

        // Strip columns that don't exist in the current table (e.g. old user_id)
        const keys = Object.keys(filled).filter(k => colSet.has(k))
        if (!keys.length) return
        const ph = keys.map(() => '?').join(', ')
        db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${ph})`)
          .run(...keys.map(k => filled[k]))
      }

      const counts = db.transaction(() => {
        const c = {}

        // ── Wallets ────────────────────────────────────────
        // v1 rows lack enabled/total_usd/last_refreshed/token_count → DB defaults kick in
        if (Array.isArray(data.wallets)) {
          data.wallets.forEach(r => insertRow('wallets', r))
          c.wallets = data.wallets.length
        }

        // ── Cashout history ────────────────────────────────
        if (Array.isArray(data.cashout_history)) {
          data.cashout_history.forEach(r => insertRow('cashout_history', r))
          c.cashouts = data.cashout_history.length
        }
        // Alternate field name (very old v0 exports)
        if (Array.isArray(data.cashoutHistory)) {
          data.cashoutHistory.forEach(r => insertRow('cashout_history', {
            id: r.id || `import_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            date: r.date,
            amount_usd: r.amountUSD ?? r.amount_usd,
            destination: r.destination,
            network: r.network,
            notes: r.notes,
          }))
          c.cashouts = (c.cashouts || 0) + data.cashoutHistory.length
        }

        // ── Portfolio snapshots ────────────────────────────
        // v1 rows have no `id` — use INSERT OR IGNORE on (captured_at, value)
        // to avoid duplicates on repeated imports.
        // v2 rows carry `id` — use INSERT OR REPLACE so they overwrite correctly.
        if (Array.isArray(data.portfolio_snapshots)) {
          const withId    = db.prepare('INSERT OR REPLACE INTO portfolio_snapshots (id, captured_at, value) VALUES (?, ?, ?)')
          const withoutId = db.prepare('INSERT OR IGNORE  INTO portfolio_snapshots (captured_at, value) VALUES (?, ?)')
          data.portfolio_snapshots.forEach(r => {
            if (r.id != null) withId.run(r.id, r.captured_at, r.value)
            else              withoutId.run(r.captured_at, r.value)
          })
          c.snapshots = data.portfolio_snapshots.length
        }
        // Alternate field name
        if (Array.isArray(data.portfolioHistory)) {
          const stmt = db.prepare('INSERT OR IGNORE INTO portfolio_snapshots (captured_at, value) VALUES (?, ?)')
          data.portfolioHistory.forEach(r => stmt.run(r.date || r.captured_at, r.value || r.totalValueUSD))
          c.snapshots = (c.snapshots || 0) + data.portfolioHistory.length
        }

        // ── Bank accounts & transactions ───────────────────
        if (Array.isArray(data.bank_accounts)) {
          data.bank_accounts.forEach(r => insertRow('bank_accounts', r))
          c.bank_accounts = data.bank_accounts.length
        }
        if (Array.isArray(data.bank_transactions)) {
          data.bank_transactions.forEach(r => insertRow('bank_transactions', r))
          c.bank_transactions = data.bank_transactions.length
        }

        // ── Holdings universe ──────────────────────────────
        // v1 rows lack price_usd / last_updated — those columns are nullable → fine
        if (Array.isArray(data.holdings_universe)) {
          data.holdings_universe.forEach(r => insertRow('holdings_universe', r))
          c.holdings = data.holdings_universe.length
        }

        // ── Holdings selection ─────────────────────────────
        if (Array.isArray(data.holdings_selection)) {
          data.holdings_selection.forEach(r => insertRow('holdings_selection', r))
        }

        // ── Major selection ────────────────────────────────
        // v1: array of strings ["BTC","ETH",…]
        // v2: array of strings (exported same way)
        if (Array.isArray(data.major_selection)) {
          const stmt = db.prepare('INSERT OR REPLACE INTO major_selection (symbol) VALUES (?)')
          data.major_selection.forEach(item => {
            if (typeof item === 'string') stmt.run(item)
            else if (item?.symbol)        stmt.run(item.symbol)
          })
        }

        return c
      })()

      res.json({ ok: true, imported: counts })
    } catch (e) {
      console.error('Import error:', e)
      res.status(500).json({ error: e.message })
    }
  })

  // ── Wipe all user data (danger) ──────────────────────────
  router.delete('/wipe', (req, res) => {
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM cashout_history').run()
        db.prepare('DELETE FROM portfolio_snapshots').run()
        db.prepare('DELETE FROM bank_transactions').run()
        db.prepare('DELETE FROM bank_accounts').run()
        db.prepare('DELETE FROM wallets').run()
        db.prepare('DELETE FROM holdings_universe').run()
        db.prepare('DELETE FROM widget_layout').run()
      })()
      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
