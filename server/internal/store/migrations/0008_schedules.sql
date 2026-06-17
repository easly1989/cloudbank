-- Posted transactions reference the template that produced them (manual or
-- scheduled). NULL for hand-entered transactions.
ALTER TABLE transactions ADD COLUMN template_id INTEGER REFERENCES templates (id) ON DELETE SET NULL;

-- A recurring schedule drives a template: it posts a copy of the template on a
-- cadence. next_due holds the next occurrence's civil date; posting advances it.
CREATE TABLE schedules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id    INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    template_id  INTEGER NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    unit         TEXT    NOT NULL DEFAULT 'month',  -- day | week | month | year
    every_n      INTEGER NOT NULL DEFAULT 1,
    next_due     TEXT    NOT NULL,                  -- YYYY-MM-DD
    weekend_mode INTEGER NOT NULL DEFAULT 0,        -- 0 none, 1 before, 2 after, 3 skip
    remaining    INTEGER,                           -- NULL = unlimited occurrences
    post_advance INTEGER NOT NULL DEFAULT 0,        -- post this many days early
    auto_post    INTEGER NOT NULL DEFAULT 1,        -- 1 auto-post, 0 remind only
    last_posted  TEXT,                              -- date of the last posted occurrence
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_schedules_wallet ON schedules (wallet_id);
CREATE INDEX idx_schedules_due ON schedules (next_due);
