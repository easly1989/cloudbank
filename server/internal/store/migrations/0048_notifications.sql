-- The notification centre (#683, #685): what each person was told, shown in
-- the bell for 90 days, and which events reach them on which channel.

CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL DEFAULT '',
    url        TEXT    NOT NULL DEFAULT '',
    -- The wallet the event is about, if any: leaving the wallet hides it.
    wallet_id  INTEGER REFERENCES wallets (id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    read_at    TEXT
);

CREATE INDEX idx_notifications_user ON notifications (user_id, id);

-- Only the choices a person changed; everything else follows the event's
-- default in internal/notify.
CREATE TABLE notification_prefs (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind    TEXT    NOT NULL,
    channel TEXT    NOT NULL,
    enabled INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, channel)
);
