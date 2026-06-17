-- Assignment rules auto-fill a transaction's payee, category and/or payment
-- mode from its memo/payee text. Rules are tried in `position` order
-- (first match wins).
CREATE TABLE assignments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id        INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    position         INTEGER NOT NULL DEFAULT 0,
    match_field      TEXT    NOT NULL DEFAULT 'memo',     -- memo | payee | both
    match_type       TEXT    NOT NULL DEFAULT 'contains', -- exact | contains | regex
    pattern          TEXT    NOT NULL,
    case_sensitive   INTEGER NOT NULL DEFAULT 0,
    set_payee_id     INTEGER REFERENCES payees (id) ON DELETE SET NULL,
    set_category_id  INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    set_payment_mode INTEGER,                              -- NULL = don't set
    apply_on_manual  INTEGER NOT NULL DEFAULT 1,
    apply_on_import  INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_assignments_wallet ON assignments (wallet_id, position, id);
