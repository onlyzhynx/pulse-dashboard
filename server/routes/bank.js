import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

// ── Auto-categorizer ──────────────────────────────────────────
// Maps a transaction title/description to a category. Order matters:
// most-specific rules first. Used when you add a transaction without picking
// a category, and by the /recategorize endpoint.
//
// These are just keyword guesses tuned for common international merchants —
// edit them freely, nothing else depends on the exact list.
export function categorize(title, desc = '') {
  const t = `${title || ''} ${desc || ''}`.toLowerCase()

  // Card bill payments — skip (the card's own transactions are tracked separately)
  if (/credit card payment|card payment|bill payment|autopay/.test(t)) return 'skip'

  // Bank fees / interest
  if (/annual fee|service charge|overdraft|late fee|interest charge/.test(t)) return 'Bill'

  // Brokers / exchanges
  if (/vanguard|fidelity|schwab|etoro|trading ?212|interactive brokers|ibkr|degiro|robinhood|coinbase|kraken|binance|bitstamp/.test(t)) return 'Investment'

  // Tech / AI / dev tools / cloud
  if (/claude|anthropic|openai|chatgpt|cursor|github|gitlab|vercel|netlify|cloudflare|digitalocean|linode|hetzner|heroku|supabase|notion|figma|jetbrains|replicate|midjourney|perplexity|google cloud|\baws\b/.test(t)) return 'Tech'

  // Health
  if (/pharmacy|chemist|apotheke|farmacia|doctor|dentist|dental|clinic|hospital|optician|physio|therapist|gym|fitness/.test(t)) return 'Health'

  // Transport / fuel
  if (/uber(?! ?eats)|lyft|bolt\.eu|freenow|taxi|\bcab\b/.test(t)) return 'Transport'
  if (/shell|esso|totalenergies|aral|repsol|petrol|fuel|gas station|parking|\btoll\b|railway|\btrain\b|deutsche bahn|trainline|transit|\bmetro\b/.test(t)) return 'Transport'

  // Food & delivery
  if (/deliveroo|just ?eat|uber ?eats|doordash|grubhub|glovo|wolt|foodora/.test(t)) return 'Food'
  if (/restaurant|bistro|brasserie|cafe|caff|coffee|starbucks|bakery|pizza|sushi|burger|mcdonald|kebab|brewery/.test(t)) return 'Food'
  if (/supermarket|grocery|tesco|sainsbury|waitrose|aldi|lidl|carrefour|rewe|edeka|albert heijn|mercadona|whole foods|trader joe|kroger|safeway/.test(t)) return 'Food'

  // Shopping
  if (/amazon|ebay|etsy|aliexpress|shein|temu|zalando|asos|ikea|zara|h&m|uniqlo|decathlon|best buy/.test(t)) return 'Shopping'

  // Subscriptions / streaming
  if (/netflix|spotify|apple|youtube|disney|\bhbo\b|prime video|paramount|audible|patreon|substack|x corp|twitter|dropbox|icloud/.test(t)) return 'Subscriptions'

  // Housing / utilities / recurring bills
  if (/\brent\b|landlord|mortgage|electric|energy|water bill|council tax|insurance|broadband|vodafone|telekom|movistar|verizon|t-mobile/.test(t)) return 'Housing'

  // Travel
  if (/hotel|hostel|airbnb|booking\.com|expedia|ryanair|easyjet|lufthansa|british airways|iberia|\bklm\b|air france|united airlines|delta air|\bflight\b/.test(t)) return 'Travel'

  // Gaming
  if (/steam|playstation|xbox|nintendo|riot games|epic games|twitch|\bgog\b/.test(t)) return 'Gaming'

  return 'Other'
}

export default function bankRouter(db) {
  const router = Router()
  router.use(requireAuth)

  // ── Accounts ──────────────────────────────────────────────
  router.get('/accounts', (req, res) => {
    const accounts = db.prepare(`
      SELECT a.*,
        COALESCE((SELECT SUM(t.amount)   FROM bank_transactions t WHERE t.account_id = a.id), 0) AS tx_total,
        COALESCE((SELECT COUNT(t.id)     FROM bank_transactions t WHERE t.account_id = a.id), 0) AS tx_count,
        a.balance + COALESCE((SELECT SUM(t.amount) FROM bank_transactions t WHERE t.account_id = a.id), 0) AS computed_balance
      FROM bank_accounts a
      ORDER BY a.position, a.created_at
    `).all()
    res.json({ accounts })
  })

  router.post('/accounts', (req, res) => {
    const { name, bank = '', type = 'checking', currency = 'USD', balance = 0, credit_limit } = req.body
    const id = `bank_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    db.prepare(`
      INSERT INTO bank_accounts (id, name, bank, type, currency, balance, credit_limit, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, name, bank, type, currency, balance, credit_limit ?? null)
    res.json({ ok: true, id })
  })

  router.patch('/accounts/:id', (req, res) => {
    // starting_balance is stored in the `balance` column
    const { balance, starting_balance, name, credit_limit } = req.body
    const fields = []
    const vals = []
    const startBal = starting_balance ?? balance
    if (startBal !== undefined) { fields.push('balance = ?'); vals.push(startBal) }
    if (name !== undefined) { fields.push('name = ?'); vals.push(name) }
    if (credit_limit !== undefined) { fields.push('credit_limit = ?'); vals.push(credit_limit) }
    if (fields.length === 0) return res.status(400).json({ error: 'nothing to update' })
    fields.push("last_updated = datetime('now')")
    vals.push(req.params.id)
    db.prepare(`UPDATE bank_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...vals)
    res.json({ ok: true })
  })

  router.delete('/accounts/:id', (req, res) => {
    const { id } = req.params
    const acc = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id)
    if (!acc) return res.json({ ok: true, tx_count: 0 })  // already gone

    // Snapshot account + transactions BEFORE the cascade so the delete is undoable.
    const txs = db.prepare('SELECT * FROM bank_transactions WHERE account_id = ?').all(id)
    db.prepare(`
      INSERT OR REPLACE INTO deleted_accounts_backup (id, name, tx_count, deleted_at, payload)
      VALUES (?, ?, ?, datetime('now'), ?)
    `).run(id, acc.name, txs.length, JSON.stringify({ account: acc, transactions: txs }))

    db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id)  // ON DELETE CASCADE clears txs
    res.json({ ok: true, id, name: acc.name, tx_count: txs.length })
  })

  // Undo a deletion: re-insert the account + its transactions from the backup.
  router.post('/accounts/:id/restore', (req, res) => {
    const { id } = req.params
    const row = db.prepare('SELECT payload FROM deleted_accounts_backup WHERE id = ?').get(id)
    if (!row) return res.status(404).json({ error: 'No backup found for this account' })

    const { account, transactions } = JSON.parse(row.payload)
    const accCols = ['id','name','bank','type','currency','balance','credit_limit','color','position','last_updated','created_at']
    const txCols  = ['id','account_id','date','description','amount','category','type','tags','notes','created_at']
    const pick = (obj, cols) => cols.filter(c => obj[c] !== undefined)

    db.transaction(() => {
      const ac = pick(account, accCols)
      db.prepare(`INSERT OR IGNORE INTO bank_accounts (${ac.join(',')}) VALUES (${ac.map(() => '?').join(',')})`)
        .run(...ac.map(c => account[c]))
      const insTx = (t) => {
        const tc = pick(t, txCols)
        db.prepare(`INSERT OR IGNORE INTO bank_transactions (${tc.join(',')}) VALUES (${tc.map(() => '?').join(',')})`)
          .run(...tc.map(c => t[c]))
      }
      for (const t of (transactions || [])) insTx(t)
      db.prepare('DELETE FROM deleted_accounts_backup WHERE id = ?').run(id)
    })()

    res.json({ ok: true, restored: (transactions || []).length })
  })

  // ── Transactions ───────────────────────────────────────────
  router.get('/transactions', (req, res) => {
    const { account_id, limit = 500, offset = 0, month, include_cashouts } = req.query

    // Bank transactions
    let q = 'SELECT *, NULL AS destination FROM bank_transactions WHERE 1=1'
    const params = []
    if (account_id) { q += ' AND account_id = ?'; params.push(account_id) }
    if (month)      { q += ' AND date LIKE ?';    params.push(`${month}%`) }
    // When merging cashouts (Home/Transactions feed), hide the auto-credit
    // bank rows so a cashout isn't listed twice (once here, once from cashout_history).
    if (include_cashouts === 'true' && !account_id) q += " AND id NOT LIKE 'btx_cashout_%'"
    let rows = db.prepare(q + ' ORDER BY date DESC').all(...params)

    // Merge cashouts (only when not filtering by account)
    if (include_cashouts === 'true' && !account_id) {
      let cq = `
        SELECT
          id, date,
          amount_usd          AS amount,
          COALESCE(notes, destination) AS description,
          'Crypto Cashout'    AS category,
          'income'            AS type,
          destination,
          notes,
          NULL                AS account_id
        FROM cashout_history
        WHERE notes NOT LIKE '%summary%'
      `
      const cParams = []
      if (month) { cq += ' AND date LIKE ?'; cParams.push(`${month}%`) }
      const cashouts = db.prepare(cq).all(...cParams)
      rows = [...rows, ...cashouts].sort((a, b) =>
        (b.date || '').localeCompare(a.date || '')
      )
    }

    const total = rows.length
    const transactions = rows.slice(parseInt(offset), parseInt(offset) + parseInt(limit))
    res.json({ transactions, total })
  })

  router.post('/transactions', (req, res) => {
    const { account_id, date, description, amount, category, type, notes } = req.body
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // No category picked → fall back to the keyword guesser.
    const cat = category ?? categorize(description || '', notes || '')
    db.prepare(`
      INSERT INTO bank_transactions (id, account_id, date, description, amount, category, type, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, account_id, date, description, amount, cat, type ?? null, notes ?? null)
    res.json({ ok: true, id })
  })

  router.patch('/transactions/:id', (req, res) => {
    const { description, amount, category, type, notes } = req.body
    db.prepare(`
      UPDATE bank_transactions SET description=?, amount=?, category=?, type=?, notes=? WHERE id=?
    `).run(description, amount, category, type, notes, req.params.id)
    res.json({ ok: true })
  })

  router.delete('/transactions/:id', (req, res) => {
    db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  // ── Re-tag existing transactions with the current categorizer ──
  // Default: only fills in uncategorized / 'Other' rows (keeps manual tags).
  // ?all=true: re-evaluate every row (still won't downgrade a tag to 'Other').
  router.post('/recategorize', (req, res) => {
    const all = req.query.all === 'true' || req.body?.all === true
    const rows = all
      ? db.prepare('SELECT id, description, notes, category FROM bank_transactions').all()
      : db.prepare("SELECT id, description, notes, category FROM bank_transactions WHERE category IS NULL OR category = '' OR category = 'Other'").all()
    const upd = db.prepare('UPDATE bank_transactions SET category = ? WHERE id = ?')
    let updated = 0
    db.transaction(() => {
      for (const r of rows) {
        const cat = categorize(r.description || '', r.notes || '')
        if (cat !== 'Other' && cat !== r.category) { upd.run(cat, r.id); updated++ }
      }
    })()
    res.json({ ok: true, scanned: rows.length, updated })
  })

  // ── Recurring / subscription detector ──────────────────────
  // Heuristic, read-only: groups expense transactions by a normalized merchant
  // key, then flags groups that repeat on a regular cadence at a stable amount.
  router.get('/recurring', (req, res) => {
    const rows = db.prepare(`
      SELECT date, amount, description, category FROM bank_transactions
      WHERE amount < 0 AND date IS NOT NULL AND COALESCE(category,'') != 'skip'
      ORDER BY date ASC
    `).all()

    // Normalize a description down to a stable merchant key (first meaningful word)
    const normalize = (d) => {
      let s = (d || '').toLowerCase()
      s = s.replace(/\b(payment|purchase|card|debit|direct debit|standing order|transfer|to|from|via)\b/g, ' ')
      s = s.replace(/[^a-zà-ÿ\s]/g, ' ').replace(/\s+/g, ' ').trim()
      const words = s.split(' ').filter(w => w.length > 2)
      return words[0] || ''
    }

    const median = (arr) => {
      if (!arr.length) return 0
      const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)

    const firstWord = (s) => {
      const w = (s || '').toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ').split(/\s+/).filter(x => x.length > 2)
      return w[0] || ''
    }

    // Evaluate one candidate group → recurring entry or null.
    // exact=true (amount-grouped) requires identical prices; otherwise allow ~35% drift (FX subs).
    const evaluate = (items, exact) => {
      if (items.length < 2) return null
      const months = new Set(items.map(t => (t.date || '').slice(0, 7)))
      if (months.size < 2) return null                    // must span ≥2 months
      const dates = items.map(t => t.date).sort()
      const gaps = []
      for (let i = 1; i < dates.length; i++) gaps.push(dayDiff(dates[i - 1], dates[i]))
      const medGap = median(gaps)
      let cadence = null, per = 1
      if (medGap >= 20 && medGap <= 45) { cadence = 'monthly'; per = 1 }
      else if (medGap >= 5 && medGap <= 10) { cadence = 'weekly'; per = 4.33 }
      else if (medGap >= 80 && medGap <= 100) { cadence = 'quarterly'; per = 1 / 3 }
      else if (medGap >= 330 && medGap <= 400) { cadence = 'yearly'; per = 1 / 12 }
      if (!cadence) return null
      // Real subscriptions bill on a similar day each month — require the
      // day-of-month values to cluster within ~8 days (circular). Kills
      // coincidental same-amount purchases on random days.
      if (cadence === 'monthly') {
        const days = items.map(t => parseInt((t.date || '').slice(8, 10), 10)).filter(Boolean).sort((a, b) => a - b)
        if (days.length >= 2) {
          let maxGap = (days[0] + 31) - days[days.length - 1]
          for (let i = 1; i < days.length; i++) maxGap = Math.max(maxGap, days[i] - days[i - 1])
          if (31 - maxGap > 8) return null
        }
      }
      const amts = items.map(t => Math.abs(t.amount))
      const medAmt = median(amts)
      if (medAmt < 2) return null                          // ignore sub-$2 noise/pre-auths
      const tol = exact ? 0.001 : 0.35
      if (!amts.every(a => Math.abs(a - medAmt) <= medAmt * tol + 0.5)) return null
      // most frequent description as label/category
      const freq = {}; let label = items[items.length - 1].description, best = 0, cat = items[items.length - 1].category
      for (const t of items) { const k = t.description || ''; freq[k] = (freq[k] || 0) + 1; if (freq[k] > best) { best = freq[k]; label = k; cat = t.category } }
      const lastDate = dates[dates.length - 1]
      const nextDate = new Date(new Date(lastDate).getTime() + medGap * 86400000).toISOString().slice(0, 10)
      return {
        cadence, count: items.length, avgAmount: medAmt, monthlyAmount: medAmt * per,
        lastDate, nextDate, label: label || '(unknown)', category: cat || 'Other',
        roundAmt: Math.round(medAmt * 100),
      }
    }

    // Two groupings: by merchant key, and by exact amount. Union + dedupe.
    const byMerchant = {}, byAmount = {}
    for (const r of rows) {
      const mk = normalize(r.description); if (mk) (byMerchant[mk] = byMerchant[mk] || []).push(r)
      const ak = String(Math.round(r.amount * 100)); (byAmount[ak] = byAmount[ak] || []).push(r)
    }
    const candidates = []
    for (const k in byMerchant) { const e = evaluate(byMerchant[k], false); if (e) candidates.push(e) }
    for (const k in byAmount)   { const e = evaluate(byAmount[k], true);    if (e) candidates.push(e) }
    candidates.sort((a, b) => b.count - a.count || b.monthlyAmount - a.monthlyAmount)

    const seen = new Set(), recurring = []
    for (const e of candidates) {
      const key = `${e.cadence}|${e.roundAmt}|${firstWord(e.label)}`
      if (seen.has(key)) continue
      seen.add(key)
      e.id = key
      recurring.push(e)
    }
    recurring.sort((a, b) => b.monthlyAmount - a.monthlyAmount)
    res.json({ recurring, monthlyTotal: recurring.reduce((s, r) => s + r.monthlyAmount, 0) })
  })

  // ── Monthly summary ────────────────────────────────────────
  router.get('/monthly', (req, res) => {
    const { month = new Date().toISOString().slice(0, 7) } = req.query
    const pattern = `${month}%`

    // Primary income: crypto cashouts
    const cashoutRow = db.prepare(`
      SELECT COALESCE(SUM(amount_usd), 0) AS total, COUNT(*) AS count
      FROM cashout_history
      WHERE date LIKE ? AND notes NOT LIKE '%summary%'
    `).get(pattern)

    // Secondary income: positive bank transactions (manual entries if any).
    // Exclude the cashout auto-credit rows — cashouts are already counted above
    // via cashout_history, so counting these too would double the income.
    const bankIncomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM bank_transactions WHERE date LIKE ? AND amount > 0 AND id NOT LIKE 'btx_cashout_%'
    `).get(pattern)

    const expensesRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM bank_transactions WHERE date LIKE ? AND amount < 0 AND COALESCE(category,'') NOT IN ('skip','Investment','Transfer')
    `).get(pattern)

    const totalIncome = cashoutRow.total + bankIncomeRow.total

    const byCategory = db.prepare(`
      SELECT category, SUM(amount) AS total, COUNT(*) AS count
      FROM bank_transactions
      WHERE date LIKE ? AND amount < 0 AND COALESCE(category,'') NOT IN ('skip','Investment','Transfer')
      GROUP BY category ORDER BY total ASC
    `).all(pattern)

    // Weekly expense buckets
    const byWeek = db.prepare(`
      SELECT
        CASE
          WHEN CAST(substr(date,9,2) AS INTEGER) <= 7  THEN 'W1'
          WHEN CAST(substr(date,9,2) AS INTEGER) <= 14 THEN 'W2'
          WHEN CAST(substr(date,9,2) AS INTEGER) <= 21 THEN 'W3'
          ELSE 'W4'
        END AS week,
        SUM(ABS(amount)) AS spent
      FROM bank_transactions
      WHERE date LIKE ? AND amount < 0 AND COALESCE(category,'') NOT IN ('skip','Investment','Transfer')
      GROUP BY week ORDER BY week
    `).all(pattern)

    res.json({
      month,
      income: totalIncome,
      cashoutIncome: cashoutRow.total,
      cashoutCount: cashoutRow.count,
      bankIncome: bankIncomeRow.total,
      expenses: expensesRow.total,
      net: totalIncome + expensesRow.total,
      byCategory,
      byWeek,
    })
  })

  // ── Spending summary (for charts) ─────────────────────────
  router.get('/spending', (req, res) => {
    const { month = new Date().toISOString().slice(0, 7) } = req.query
    const byCategory = db.prepare(`
      SELECT category, SUM(amount) as total
      FROM bank_transactions
      WHERE date LIKE ? AND amount < 0 AND COALESCE(category,'') NOT IN ('skip','Investment','Transfer')
      GROUP BY category
      ORDER BY total ASC
    `).all(`${month}%`)

    const monthlyTotals = db.prepare(`
      SELECT substr(date, 1, 7) as month, SUM(amount) as total
      FROM bank_transactions
      WHERE amount < 0 AND COALESCE(category,'') NOT IN ('skip','Investment','Transfer')
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all()

    res.json({ byCategory, monthlyTotals })
  })

  return router
}
