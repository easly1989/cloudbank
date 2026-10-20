-- The AI's budget proposals (#698): a switch of their own, off at first, and
-- the proposals, each the asking user's alone on one wallet.
ALTER TABLE ai_settings ADD COLUMN budgets_on INTEGER NOT NULL DEFAULT 0;

-- One proposal per user, wallet, kind and month it was made in. The basis
-- holds the rows CloudBank worked out, which "Ignore" compares later ones
-- with. State: open, later (hidden until later_until), ignored, applied (every
-- row saved), replaced (by the next month's).
CREATE TABLE ai_proposals (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id   INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,
    period      TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    basis       TEXT    NOT NULL,
    model       TEXT    NOT NULL,
    state       TEXT    NOT NULL DEFAULT 'open',
    later_until TEXT    NOT NULL DEFAULT '',
    applied     TEXT    NOT NULL DEFAULT '[]',
    feedback    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, wallet_id, kind, period)
);
