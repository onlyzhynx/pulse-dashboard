import { Router } from 'express'
import { loginHandler } from '../middleware/auth.js'

const router = Router()

router.post('/login', loginHandler)
router.post('/logout', (req, res) => {
  req.session.destroy()
  res.json({ ok: true })
})
router.get('/status', (req, res) => {
  res.json({ authenticated: !!req.session?.authed })
})

export default router
