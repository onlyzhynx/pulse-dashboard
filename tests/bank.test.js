// Regression tests for the bank + cashout routes.
// Run: npm test  (node --test, no extra dependencies)
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import Database from 'better-sqlite3'
import { initSchema } from '../server/db/schema.js'
import bankRouter, { categorize } from '../server/routes/bank.js'
import cashoutRouter from '../server/routes/cashout.js'

const ACCT = 'acct1'

function makeApp(t) {
  const db = new Database(':memory:')
  initSchema(db)
  db.prepare(`INSERT INTO bank_accounts (id, name, bank, type, currency)
              VALUES (?, 'Test', 'Demo Bank', 'checking', 'USD')`).run(ACCT)
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use((req, _res, next) => { req.session = { authed: true }; next() })  // requireAuth stub
  app.use('/api/bank', bankRouter(db))
  app.use('/api/cashout', cashoutRouter(db))
  const srv = app.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  t.after(() => { srv.close(); db.close() })
  const send = (method) => async (path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json()
  }
  const get = async (path) => (await fetch(base + path)).json()
  const count = () => db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n
  return { db, post: send('POST'), del: send('DELETE'), get, count }
}

const addTx = (post, tx) => post('/api/bank/transactions', { account_id: ACCT, ...tx })

// ── Categorizer ───────────────────────────────────────────────

test('categorizer: known merchants map to categories, unknown falls back to Other', () => {
  assert.equal(categorize('NETFLIX.COM'), 'Subscriptions')
  assert.equal(categorize('TESCO SUPERSTORE'), 'Food')
  assert.equal(categorize('GITHUB.COM'), 'Tech')
  assert.equal(categorize('RYANAIR FLIGHT'), 'Travel')
  assert.equal(categorize('QWERTY HOLDINGS LTD'), 'Other')
})

test('categorizer: the more specific rule wins for lookalike merchants', () => {
  assert.equal(categorize('UBER TRIP 042'), 'Transport')
  assert.equal(categorize('UBER EATS'), 'Food')
})

test('categorizer: card bill payments are skipped so they never double-count', () => {
  assert.equal(categorize('CREDIT CARD PAYMENT'), 'skip')
})

test('a transaction posted without a category gets one from the categorizer', async (t) => {
  const { post, db } = makeApp(t)
  const r = await addTx(post, { date: '2026-06-02', description: 'SPOTIFY AB', amount: -10.99 })
  const row = db.prepare('SELECT category FROM bank_transactions WHERE id = ?').get(r.id)
  assert.equal(row.category, 'Subscriptions')
})

// ── Monthly aggregation exclusions ────────────────────────────

test('monthly: skip / Investment / Transfer rows stay out of Money Out', async (t) => {
  const { post, get } = makeApp(t)
  await addTx(post, { date: '2026-06-02', description: 'Groceries',           amount: -100,  category: 'Food' })
  await addTx(post, { date: '2026-06-05', description: 'Credit card payment', amount: -900,  category: 'skip' })
  await addTx(post, { date: '2026-06-08', description: 'Broker funding',      amount: -5000, category: 'Investment' })
  await addTx(post, { date: '2026-06-09', description: 'Move to savings',     amount: -250,  category: 'Transfer' })

  const m = await get('/api/bank/monthly?month=2026-06')
  assert.equal(m.expenses, -100)
  assert.deepEqual(m.byCategory.map(c => c.category), ['Food'])
})

test('cashout income counts once, even when it also credits a bank account', async (t) => {
  const { post, get } = makeApp(t)
  await post('/api/cashout/history', {
    date: '2026-06-10', amount_usd: 4000, destination: 'Bank', network: 'Solana',
    bank_account_id: ACCT, bank_credit_amount: 4000,
  })
  const m = await get('/api/bank/monthly?month=2026-06')
  assert.equal(m.cashoutIncome, 4000)
  assert.equal(m.bankIncome, 0)     // the auto-credit bank row is excluded
  assert.equal(m.income, 4000)
})

// ── Cashouts ──────────────────────────────────────────────────

test('cashout running totals are recomputed in date order, not insert order', async (t) => {
  const { post, db } = makeApp(t)
  await post('/api/cashout/history', { date: '2026-06-10', amount_usd: 1000, destination: 'Bank' })
  await post('/api/cashout/history', { date: '2026-06-01', amount_usd: 500,  destination: 'Bank' })
  const rows = db.prepare('SELECT date, running_total_usd FROM cashout_history ORDER BY date ASC').all()
  assert.deepEqual(rows.map(r => r.running_total_usd), [500, 1500])
})

// ── Delete safety ─────────────────────────────────────────────

test('deleting an account is undoable and brings its transactions back', async (t) => {
  const { post, del, count } = makeApp(t)
  await addTx(post, { date: '2026-06-02', description: 'Groceries', amount: -100, category: 'Food' })
  await addTx(post, { date: '2026-06-03', description: 'Coffee',    amount: -4,   category: 'Food' })
  assert.equal(count(), 2)

  const d = await del(`/api/bank/accounts/${ACCT}`)
  assert.equal(d.tx_count, 2)
  assert.equal(count(), 0)

  const r = await post(`/api/bank/accounts/${ACCT}/restore`)
  assert.equal(r.restored, 2)
  assert.equal(count(), 2)
})

// ── Recurring detector ────────────────────────────────────────

test('recurring: a monthly subscription is detected, a one-off purchase is not', async (t) => {
  const { post, get } = makeApp(t)
  for (const date of ['2026-03-14', '2026-04-14', '2026-05-14', '2026-06-14']) {
    await addTx(post, { date, description: 'NETFLIX.COM', amount: -15.99, category: 'Subscriptions' })
  }
  await addTx(post, { date: '2026-05-02', description: 'IKEA STORE', amount: -230, category: 'Shopping' })

  const r = await get('/api/bank/recurring')
  const netflix = r.recurring.find(x => /netflix/i.test(x.label))
  assert.ok(netflix, `expected NETFLIX in ${JSON.stringify(r.recurring)}`)
  assert.equal(netflix.cadence, 'monthly')
  assert.ok(Math.abs(netflix.avgAmount - 15.99) < 0.01)
  assert.ok(!r.recurring.some(x => /ikea/i.test(x.label)))
})
