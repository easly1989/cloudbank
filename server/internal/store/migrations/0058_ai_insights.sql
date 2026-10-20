-- The AI's switches, wallets, limit and log, and the reports it writes (#696).
--
-- Each feature has its own switch under the master one (enabled). They start
-- off, except for whoever already had the AI on: the three features that
-- existed then keep working for them.
ALTER TABLE ai_settings ADD COLUMN suggest_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_settings ADD COLUMN entry_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_settings ADD COLUMN mail_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_settings ADD COLUMN reports_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_settings ADD COLUMN monthly_limit INTEGER NOT NULL DEFAULT 200;
-- The colours flowing round the AI box; never under reduced motion anyway.
ALTER TABLE ai_settings ADD COLUMN motion INTEGER NOT NULL DEFAULT 1;
UPDATE ai_settings SET suggest_on = 1, entry_on = 1, mail_on = 1 WHERE enabled = 1;

-- The wallets a user took out of the AI's reach. Stored as exclusions, so every
-- wallet, a new one too, is in until it is taken out.
CREATE TABLE ai_wallets_off (
    user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, wallet_id)
);

-- Every call to the model: what was sent, word for word, and for what. It is
-- the log the user reads and what the monthly limit counts. Kept 90 days.
CREATE TABLE ai_sends (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id  INTEGER REFERENCES wallets (id) ON DELETE SET NULL,
    feature    TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    sent       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ai_sends_user_created ON ai_sends (user_id, created_at);

-- A report the AI wrote for one user on one wallet: private to that user.
-- basis holds the numbers the server computed (JSON), body the model's text.
CREATE TABLE ai_reports (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id  INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    period     TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    basis      TEXT    NOT NULL,
    model      TEXT    NOT NULL,
    feedback   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ai_reports_user_wallet ON ai_reports (user_id, wallet_id, created_at);
