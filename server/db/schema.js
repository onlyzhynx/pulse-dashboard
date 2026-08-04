export function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      label TEXT,
      address TEXT NOT NULL,
      network TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      source TEXT DEFAULT 'user',
      position INTEGER DEFAULT 0,
      fetch_strategy TEXT DEFAULT 'onchain',
      enabled INTEGER DEFAULT 1,
      total_usd REAL DEFAULT 0,
      last_refreshed TEXT,
      token_count INTEGER DEFAULT 0,
      -- side=1 tucks a wallet into the collapsed "Side wallets" folder in the UI
      side INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS holdings_universe (
      id TEXT PRIMARY KEY,
      token_key TEXT,
      wallet_id TEXT,
      symbol TEXT,
      name TEXT,
      network TEXT,
      address TEXT,
      coingecko_id TEXT,
      holdings_units REAL DEFAULT 0,
      price_usd REAL,
      source TEXT DEFAULT 'user',
      last_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS holdings_selection (
      network TEXT NOT NULL,
      token_ids TEXT DEFAULT '[]',
      PRIMARY KEY (network)
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      value REAL NOT NULL
    );

    -- Crypto → fiat cashouts. Amounts are USD; the UI converts for display.
    CREATE TABLE IF NOT EXISTS cashout_history (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      amount_usd REAL,
      destination TEXT,
      notes TEXT,
      network TEXT,
      running_total_usd REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bank TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'checking',
      currency TEXT DEFAULT 'USD',
      balance REAL DEFAULT 0,
      credit_limit REAL,
      color TEXT,
      position INTEGER DEFAULT 0,
      last_updated TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bank_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      category TEXT,
      type TEXT,
      tags TEXT DEFAULT '[]',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
    );

    -- Safety net: holds a JSON snapshot of any deleted bank account + its
    -- transactions so a deletion can be undone (see bank.js delete/restore).
    CREATE TABLE IF NOT EXISTS deleted_accounts_backup (
      id TEXT PRIMARY KEY,
      name TEXT,
      tx_count INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT (datetime('now')),
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS widget_layout (
      id INTEGER PRIMARY KEY DEFAULT 1,
      layouts_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS major_tokens (
      symbol TEXT PRIMARY KEY,
      label TEXT,
      binance_symbol TEXT,
      source TEXT DEFAULT 'preset'
    );

    CREATE TABLE IF NOT EXISTS major_selection (
      symbol TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- First time a token_key was ever seen in any wallet (survives the
    -- per-wallet holdings rebuild) → powers the "NEW" badge for fresh buys.
    CREATE TABLE IF NOT EXISTS token_first_seen (
      token_key TEXT PRIMARY KEY,
      first_seen TEXT DEFAULT (datetime('now'))
    );

    -- User-set ticker/name overrides for tokens the auto-resolver can't name.
    CREATE TABLE IF NOT EXISTS token_overrides (
      token_key TEXT PRIMARY KEY,
      symbol TEXT,
      name TEXT
    );

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(captured_at);
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_cashout_date ON cashout_history(date);
    CREATE INDEX IF NOT EXISTS idx_holdings_token_key ON holdings_universe(token_key);
    CREATE INDEX IF NOT EXISTS idx_holdings_wallet ON holdings_universe(wallet_id);
  `)

  // ── Seed the crypto ticker with the usual majors on a fresh database ──
  try {
    const hasMajors = db.prepare('SELECT COUNT(*) as c FROM major_selection').get()
    if (hasMajors.c === 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO major_selection (symbol) VALUES (?)')
      ;['BTC', 'ETH', 'SOL', 'BNB'].forEach(s => ins.run(s))
    }
  } catch (e) { /* ignore */ }
}
