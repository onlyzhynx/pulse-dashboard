import bcrypt from 'bcryptjs'

const PASSWORD = process.env.DASHBOARD_PASSWORD || 'pulse'
let passwordHash = null

async function getHash() {
  if (!passwordHash) {
    passwordHash = await bcrypt.hash(PASSWORD, 10)
  }
  return passwordHash
}

export async function requireAuth(req, res, next) {
  if (req.session?.authed) return next()
  res.status(401).json({ error: 'Unauthorized' })
}

export async function loginHandler(req, res) {
  const { password } = req.body
  if (!password) return res.status(400).json({ ok: false, error: 'Password required' })
  const hash = await getHash()
  const ok = await bcrypt.compare(password, hash)
  if (ok) {
    req.session.authed = true
    res.json({ ok: true })
  } else {
    res.status(401).json({ ok: false, error: 'Invalid password' })
  }
}
