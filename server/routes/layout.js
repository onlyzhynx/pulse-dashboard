import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

export default function layoutRouter(db) {
  const router = Router()
  router.use(requireAuth)

  router.get('/', (req, res) => {
    const row = db.prepare('SELECT layouts_json FROM widget_layout WHERE id = 1').get()
    if (row) {
      const data = JSON.parse(row.layouts_json)
      // Support both old { layouts } format and new { tabs } format
      res.json(data)
    } else {
      res.json({})
    }
  })

  router.put('/', (req, res) => {
    const { layouts, tabs } = req.body
    if (!layouts && !tabs) return res.status(400).json({ error: 'layouts or tabs required' })
    const data = tabs ? { tabs } : { layouts }
    db.prepare(`
      INSERT INTO widget_layout (id, layouts_json, updated_at) VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET layouts_json = excluded.layouts_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(data))
    res.json({ ok: true })
  })

  return router
}
