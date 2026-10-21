-- The AI's payee cleanup (#708): a switch of its own, off at first, and each
-- wallet's last cleanup, kept so it can be undone until the next one. undo is
-- JSON: the names it changed, the payees it merged with what pointed at them,
-- and the rules it made.
ALTER TABLE ai_settings ADD COLUMN payees_on INTEGER NOT NULL DEFAULT 0;

CREATE TABLE payee_cleanups (
    wallet_id  INTEGER PRIMARY KEY REFERENCES wallets (id) ON DELETE CASCADE,
    payees     INTEGER NOT NULL,
    names      INTEGER NOT NULL,
    rules      INTEGER NOT NULL,
    undo       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
