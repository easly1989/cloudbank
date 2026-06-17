-- Reusable transaction templates ("quick seizure"): a saved scaffold that
-- pre-fills the entry form. A template captures every transaction field,
-- optional split lines, and an optional transfer target account.
CREATE TABLE templates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id     INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    account_id    INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    amount        INTEGER NOT NULL DEFAULT 0,   -- signed minor units
    payment_mode  INTEGER NOT NULL DEFAULT 0,
    status        INTEGER NOT NULL DEFAULT 0,
    info          TEXT    NOT NULL DEFAULT '',
    payee_id      INTEGER REFERENCES payees (id) ON DELETE SET NULL,
    category_id   INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    memo          TEXT    NOT NULL DEFAULT '',
    tags          TEXT    NOT NULL DEFAULT '',   -- comma-separated tag names
    is_split      INTEGER NOT NULL DEFAULT 0,
    is_transfer   INTEGER NOT NULL DEFAULT 0,
    to_account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_templates_wallet ON templates (wallet_id);

CREATE TABLE template_splits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    amount      INTEGER NOT NULL,
    memo        TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_template_splits_template ON template_splits (template_id);
