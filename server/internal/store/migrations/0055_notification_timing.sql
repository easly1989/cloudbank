-- When notifications reach a person outside the app (#692).

-- The person's time zone (from their browser), the time of the daily digest,
-- the quiet hours (local "HH:MM", from inclusive, to exclusive) and how many
-- days a transaction may wait on the Review page before it is announced.
ALTER TABLE notification_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT '';
ALTER TABLE notification_settings ADD COLUMN digest_at TEXT NOT NULL DEFAULT '08:00';
ALTER TABLE notification_settings ADD COLUMN quiet_hours INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_settings ADD COLUMN quiet_from TEXT NOT NULL DEFAULT '22:00';
ALTER TABLE notification_settings ADD COLUMN quiet_to TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE notification_settings ADD COLUMN review_days INTEGER NOT NULL DEFAULT 3;

-- The events a person collects in the daily digest; every other one is sent
-- at once.
CREATE TABLE notification_digest_kinds (
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind    TEXT    NOT NULL,
    PRIMARY KEY (user_id, kind)
);

-- What waits, per channel outside the app: for the digest (digest = 1) or for
-- the end of the quiet hours (digest = 0). The payload is the queued event.
CREATE TABLE notification_held (
    id      INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    channel TEXT    NOT NULL,
    payload TEXT    NOT NULL,
    digest  INTEGER NOT NULL,
    held_at TEXT    NOT NULL
);
CREATE INDEX notification_held_user ON notification_held (user_id);

-- Since when each transaction has waited on the Review page: a transaction has
-- no creation time of its own, and its date says nothing about when it came.
CREATE TABLE review_waiting (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions (id) ON DELETE CASCADE,
    wallet_id      INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    since          TEXT    NOT NULL
);
CREATE INDEX review_waiting_wallet ON review_waiting (wallet_id);
