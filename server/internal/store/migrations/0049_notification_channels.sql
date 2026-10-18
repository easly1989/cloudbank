-- External notification channels (#686): where each person's notifications go
-- besides the bell and push, and the queue that delivers them with retries.

CREATE TABLE notification_channels (
    user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel       TEXT    NOT NULL,
    -- The email address, or the webhook URL sealed (its path is often the key).
    target        TEXT    NOT NULL,
    -- The webhook's signing secret, sealed; empty for none.
    secret        TEXT    NOT NULL DEFAULT '',
    -- Saved by an administrator: it may reach the local network.
    local_ok      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT    NOT NULL DEFAULT '',
    last_error_at TEXT,
    last_ok_at    TEXT,
    PRIMARY KEY (user_id, channel)
);

CREATE TABLE notification_deliveries (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel  TEXT    NOT NULL,
    -- The event, as JSON.
    payload  TEXT    NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at  TEXT    NOT NULL
);

CREATE INDEX idx_notification_deliveries_next ON notification_deliveries (next_at);
