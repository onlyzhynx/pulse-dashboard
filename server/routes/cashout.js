import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

export default function cashoutRouter(db) {
  const router = Router()
  router.use(requireAuth)

  // Recalculate running totals for all entries sorted by date
  const recalcRunning = db.transaction(() => {
    const rows = db.prepare('SELECT id, amount_usd FROM cashout_history ORDER BY date ASC, created_at ASC').all()
    let running = 0
    const upd = db.prepare('UPDATE cashout_history SET running_total_usd = ? WHERE id = ?')
    for (const row of rows) {
      running += row.amount_usd || 0
      upd.run(running, row.id)
    }
  })

  router.get('/history', (req, res) => {
    const history = db.prepare('SELECT * FROM cashout_history ORDER BY date ASC, created_at ASC').all()
    res.json({ history })
  })

  router.post('/history', (req, res) => {
    const { date, amount_usd, destination, notes, network, bank_account_id, bank_credit_amount } = req.body
    if (!date || amount_usd == null) return res.status(400).json({ error: 'date and amount_usd required' })
    const id = `cashout_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    db.transaction(() => {
      db.prepare(`
        INSERT INTO cashout_history (id, date, amount_usd, destination, notes, network, running_total_usd)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(id, date, amount_usd, destination ?? '', notes ?? '', network ?? 'Multi')

      // Auto-credit bank account if requested
      if (bank_account_id && bank_credit_amount) {
        const credit = parseFloat(bank_credit_amount)
        if (!isNaN(credit) && credit > 0) {
          db.prepare('UPDATE bank_accounts SET balance = balance + ?, last_updated = datetime(\'now\') WHERE id = ?')
            .run(credit, bank_account_id)
          const txId = `btx_cashout_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          db.prepare(`
            INSERT INTO bank_transactions (id, account_id, date, description, amount, category, type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(txId, bank_account_id, date, `Cashout: ${destination ?? ''}`.trim(), credit, 'Income', 'income')
        }
      }
    })()

    recalcRunning()
    res.json({ ok: true, id })
  })

  router.put('/history/:id', (req, res) => {
    const { date, amount_usd, destination, notes, network } = req.body
    db.prepare(`
      UPDATE cashout_history
      SET date = ?, amount_usd = ?, destination = ?, notes = ?, network = ?
      WHERE id = ?
    `).run(date, amount_usd, destination ?? '', notes ?? '', network ?? 'Multi', req.params.id)
    recalcRunning()
    res.json({ ok: true })
  })

  router.delete('/history/:id', (req, res) => {
    db.prepare('DELETE FROM cashout_history WHERE id = ?').run(req.params.id)
    recalcRunning()
    res.json({ ok: true })
  })

  return router
}
