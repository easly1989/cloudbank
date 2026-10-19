-- A private calendar address per user and wallet (#694): the schedules' dates
-- for a phone's calendar app to subscribe to. The token is sealed with
-- CB_SECRET_KEY when one is set, so the page can show the address again.
CREATE TABLE calendar_feeds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id  INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    token      TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, wallet_id)
);
