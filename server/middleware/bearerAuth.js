import crypto from 'crypto'

// Read-only connector auth — completely separate from the cookie/session auth the
// dashboard UI uses (middleware/auth.js). The agent connector is reached with a
// static bearer token instead of a login session, so there's no cookie/CSRF
// surface and the agent can never touch a write route (none are mounted under it).
//
// Token comes from PULSE_API_TOKEN. If it's unset the connector is *disabled*
// (503) rather than open — fail closed, never expose the portfolio by accident.
export function requireBearer(req, res, next) {
  const expected = process.env.PULSE_API_TOKEN || ''
  if (!expected) {
    return res.status(503).json({
      error: 'Connector disabled. Set PULSE_API_TOKEN in the server environment to enable the read-only portfolio API.',
    })
  }

  const auth = (req.get('authorization') || '').trim()
  const m = /^Bearer\s+(.+)$/i.exec(auth)
  const provided = m ? m[1].trim() : (req.get('x-api-key') || '').trim()

  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// Constant-time comparison so the token can't be guessed byte-by-byte via timing.
function safeEqual(a, b) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}
