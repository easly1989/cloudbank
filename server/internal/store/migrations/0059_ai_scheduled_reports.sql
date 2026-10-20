-- The AI's reports that come by themselves (#697). The monthly one comes with
-- the reports switch; the weekly starts off and the yearly on.
ALTER TABLE ai_settings ADD COLUMN weekly_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_settings ADD COLUMN yearly_on INTEGER NOT NULL DEFAULT 1;

-- What the scheduler did about one period of one wallet for one person, so it
-- does it once: written, nothing to report on, skipped at the limit. A failure
-- is not kept, so it is tried again.
CREATE TABLE ai_report_runs (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id  INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    period     TEXT    NOT NULL,
    outcome    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, wallet_id, kind, period)
);
