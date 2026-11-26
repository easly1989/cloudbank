-- Merging two register rows into one, field by field (#786): each wallet's
-- last merge, kept so it can be undone until the next one. undo is JSON: both
-- rows as they were, their tags, and the attachments and mails that moved.
CREATE TABLE transaction_merges (
    wallet_id  INTEGER PRIMARY KEY REFERENCES wallets (id) ON DELETE CASCADE,
    undo       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The import refs a merge took off a row (both rows came from the bank, and a
-- row keeps one ref). Import and bank sync count them as already imported, so
-- the dropped row does not come back on the next sync, and settle the row
-- they were merged into when the bank books it.
CREATE TABLE merged_import_refs (
    account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    import_ref     TEXT    NOT NULL,
    transaction_id INTEGER REFERENCES transactions (id) ON DELETE SET NULL,
    PRIMARY KEY (account_id, import_ref)
);
