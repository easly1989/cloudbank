-- Attach receipts/files to transactions (HomeBank wishlist #591501). The file
-- bytes live on disk under ${CB_DATA_DIR}/attachments/<walletId>/<storageKey>;
-- this table holds only the metadata. Deleting a transaction (or its wallet)
-- cascades the rows; the application removes the backing files.
CREATE TABLE attachments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id      INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    filename       TEXT    NOT NULL,
    content_type   TEXT    NOT NULL DEFAULT '',
    size           INTEGER NOT NULL DEFAULT 0,
    storage_key    TEXT    NOT NULL,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_attachments_transaction ON attachments (transaction_id);
CREATE INDEX idx_attachments_wallet ON attachments (wallet_id);
