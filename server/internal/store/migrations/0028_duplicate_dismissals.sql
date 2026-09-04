-- Pairs of transactions a reviewer has marked "not a duplicate", so the bank-sync
-- review's duplicate finder stops surfacing them. Stored normalized with
-- txn_a_id < txn_b_id; either transaction being deleted removes the dismissal.
CREATE TABLE duplicate_dismissals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id  INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    txn_a_id   INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    txn_b_id   INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (wallet_id, txn_a_id, txn_b_id)
);

CREATE INDEX idx_dupdismiss_wallet ON duplicate_dismissals (wallet_id);
