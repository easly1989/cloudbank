-- Automatic bank sync connections (SimpleFIN for now). access_url embeds Basic
-- Auth credentials — a secret; it is stored server-side and never returned to
-- the client.
CREATE TABLE bank_connections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id      INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    provider       TEXT    NOT NULL DEFAULT 'simplefin',
    access_url     TEXT    NOT NULL,
    name           TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_synced_at TEXT
);

CREATE INDEX idx_bank_conn_wallet ON bank_connections (wallet_id);

-- Maps a provider account (external_id) to a CloudBank account.
CREATE TABLE bank_links (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL REFERENCES bank_connections (id) ON DELETE CASCADE,
    external_id   TEXT    NOT NULL,
    account_id    INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    UNIQUE (connection_id, external_id)
);

CREATE INDEX idx_bank_links_conn ON bank_links (connection_id);
