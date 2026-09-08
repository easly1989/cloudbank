-- Rolling history of bank-sync runs, so the UI can show — per connection and per
-- linked account — exactly how each recent sync went (fetched / imported /
-- reconciled / errors). Older runs are pruned to a small cap per connection, so
-- this stays a short audit trail rather than an unbounded log.
CREATE TABLE bank_sync_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL REFERENCES bank_connections (id) ON DELETE CASCADE,
    ran_at        TEXT    NOT NULL,
    triggered_by  TEXT    NOT NULL DEFAULT '', -- 'manual' | 'auto'
    status        TEXT    NOT NULL DEFAULT '', -- 'ok' | 'partial' | 'error'
    imported      INTEGER NOT NULL DEFAULT 0,
    reconciled    INTEGER NOT NULL DEFAULT 0,
    message       TEXT    NOT NULL DEFAULT '',
    accounts_json TEXT    NOT NULL DEFAULT '[]' -- per-account breakdown ([]AccountSyncResult)
);

CREATE INDEX idx_bank_sync_runs_conn ON bank_sync_runs (connection_id, id DESC);
