-- An internal transfer links two transactions: a negative leg in the source
-- account and a positive leg in the destination account. Deleting either
-- transaction cascades this row away; the application deletes the paired leg so
-- no orphan legs remain.
CREATE TABLE transfers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    txn_from_id INTEGER NOT NULL UNIQUE REFERENCES transactions (id) ON DELETE CASCADE,
    txn_to_id   INTEGER NOT NULL UNIQUE REFERENCES transactions (id) ON DELETE CASCADE
);

CREATE INDEX idx_transfers_to ON transfers (txn_to_id);
