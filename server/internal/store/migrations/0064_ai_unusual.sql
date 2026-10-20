-- The AI's unusual transactions (#700): a switch of their own, off at first.
ALTER TABLE ai_settings ADD COLUMN unusual_on INTEGER NOT NULL DEFAULT 0;

-- The expenses flagged, each the reading user's alone. kind: scale (out of
-- scale for its payee), new (a new payee, a large amount), double (charged
-- twice; other_id is the first charge). amount is the expense, positive, when
-- flagged: "It's fine" holds until it changes. usual is the payee's median
-- (scale) or the wallet's yardstick (new); payments the payee's expenses in
-- the year before (scale). state: open, fine.
CREATE TABLE ai_unusual (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id      INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    kind           TEXT    NOT NULL,
    other_id       INTEGER REFERENCES transactions (id) ON DELETE CASCADE,
    amount         INTEGER NOT NULL,
    usual          INTEGER NOT NULL DEFAULT 0,
    payments       INTEGER NOT NULL DEFAULT 0,
    state          TEXT    NOT NULL DEFAULT 'open',
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, transaction_id)
);

-- Per user and wallet: the last transaction looked at, and the model's
-- sentences about the expenses flagged, with the user's thumb on them.
CREATE TABLE ai_unusual_scans (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id  INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    last_txn   INTEGER NOT NULL DEFAULT 0,
    body       TEXT    NOT NULL DEFAULT '',
    model      TEXT    NOT NULL DEFAULT '',
    feedback   INTEGER NOT NULL DEFAULT 0,
    written_at TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, wallet_id)
);
