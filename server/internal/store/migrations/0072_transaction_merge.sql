-- Merging two register rows into one, field by field (#786): each wallet's
-- last merge, kept so it can be undone until the next one. undo is JSON: both
-- rows as they were, their tags, and the attachments and mails that moved.
CREATE TABLE transaction_merges (
    wallet_id  INTEGER PRIMARY KEY REFERENCES wallets (id) ON DELETE CASCADE,
    undo       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
