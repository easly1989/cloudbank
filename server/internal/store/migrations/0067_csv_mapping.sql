-- The AI's CSV column mapping (#709): its switch, and the mappings a wallet
-- remembers for files with the same header row.
ALTER TABLE ai_settings ADD COLUMN import_on INTEGER NOT NULL DEFAULT 0;

CREATE TABLE csv_mappings (
    id            INTEGER PRIMARY KEY,
    wallet_id     INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    -- The header row as a JSON array of column names, in order.
    header        TEXT    NOT NULL,
    -- field → column index, as JSON.
    mapping       TEXT    NOT NULL,
    date_format   TEXT    NOT NULL,
    decimal_char  TEXT    NOT NULL,
    invert_amount INTEGER NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (wallet_id, header)
);
