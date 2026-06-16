-- Free-form tags, created on the fly and shared across a wallet's transactions.
CREATE TABLE tags (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    name      TEXT    NOT NULL,
    UNIQUE (wallet_id, name)
);

CREATE INDEX idx_tags_wallet ON tags (wallet_id);

-- Transactions. amount is signed int64 minor units in the account's currency
-- (negative = expense, positive = income). A split transaction (is_split = 1)
-- has its lines in the splits table and a NULL category_id.
CREATE TABLE transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id    INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    account_id   INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    date         TEXT    NOT NULL,                -- YYYY-MM-DD
    amount       INTEGER NOT NULL,
    payment_mode INTEGER NOT NULL DEFAULT 0,      -- 0..11, HomeBank PAYMODE
    status       INTEGER NOT NULL DEFAULT 0,      -- 0 none|1 cleared|2 reconciled|3 remind|4 void
    info         TEXT    NOT NULL DEFAULT '',      -- check number / reference
    payee_id     INTEGER REFERENCES payees (id) ON DELETE SET NULL,
    category_id  INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    memo         TEXT    NOT NULL DEFAULT '',
    is_split     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_transactions_account_date ON transactions (account_id, date);

CREATE INDEX idx_transactions_wallet ON transactions (wallet_id);

CREATE INDEX idx_transactions_payee ON transactions (payee_id);

CREATE INDEX idx_transactions_category ON transactions (category_id);

-- Split lines. The application enforces SUM(amount) = transaction.amount.
CREATE TABLE splits (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    category_id    INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    amount         INTEGER NOT NULL,
    memo           TEXT    NOT NULL DEFAULT '',
    position       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_splits_transaction ON splits (transaction_id);

CREATE TABLE transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    tag_id         INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, tag_id)
);
