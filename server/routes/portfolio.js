import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { snapshotNetWorth } from '../services/portfolioSnapshot.js'

const RANGE_MAP = {
  '7D': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 99999
}

export default function portfolioRouter(db) {
  const router = Router()
  router.use(requireAuth)

  router.get('/history', (req, res) => {
    const days = RANGE_MAP[req.query.range] ?? 99999
    const snapshots = db.prepare(`
      SELECT id, captured_at, value FROM portfolio_snapshots
      WHERE captured_at >= datetime('now', '-${days} days')
      ORDER BY captured_at ASC
    `).all()
    res.json({ snapshots })
  })

  router.post('/snapshots', (req, res) => {
    const { value } = req.body
    if (!value) return res.status(400).json({ error: 'value required' })
    db.prepare("INSERT INTO portfolio_snapshots (captured_at, value) VALUES (datetime('now'), ?)").run(value)
    res.json({ ok: true })
  })

  router.delete('/snapshots/:id', (req, res) => {
    db.prepare('DELETE FROM portfolio_snapshots WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  router.post('/snapshot-now', (req, res) => {
    const r = snapshotNetWorth(db, { force: true })   // net worth (crypto + bank), consistent series
    if (r.skipped) return res.json({ ok: false, reason: r.skipped })
    res.json({ ok: true, value: r.value })
  })

  // Compact history to one point per day — the day's HIGHEST value (which also
  // picks the consistent net-worth points over old crypto-only ones).
  router.post('/compact', (req, res) => {
    const before = db.prepare('SELECT COUNT(*) AS c FROM portfolio_snapshots').get().c
    db.prepare(`
      DELETE FROM portfolio_snapshots
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY date(captured_at) ORDER BY value DESC, captured_at DESC
          ) AS rn
          FROM portfolio_snapshots
        ) WHERE rn = 1
      )
    `).run()
    const after = db.prepare('SELECT COUNT(*) AS c FROM portfolio_snapshots').get().c
    res.json({ ok: true, kept: after, removed: before - after })
  })

  return router
}
