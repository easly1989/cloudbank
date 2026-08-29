-- Server-wide key/value config (e.g. the auto-generated VAPID keypair).
CREATE TABLE app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Web Push subscriptions: one per browser that opted in. Keyed by endpoint so a
-- re-subscribe from the same browser updates in place.
CREATE TABLE push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    endpoint   TEXT    NOT NULL UNIQUE,
    p256dh     TEXT    NOT NULL,
    auth       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_push_sub_user ON push_subscriptions (user_id);

-- Once-per-occurrence dedup for reminder pushes (ref e.g. "bill:{wallet}:{sched}:{date}").
CREATE TABLE push_reminders (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    ref     TEXT    NOT NULL,
    sent_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, ref)
);
