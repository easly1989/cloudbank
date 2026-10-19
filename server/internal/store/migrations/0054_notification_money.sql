-- The money events (#691).

-- Where a transaction came from, so a large one is announced only when someone
-- else put it there: created_by is the person who entered it through the app,
-- origin what wrote it on its own (bank, mail, schedule) or a file import.
-- Rows written before this are neither, and announce nothing.
ALTER TABLE transactions ADD COLUMN origin TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN created_by INTEGER REFERENCES users (id) ON DELETE SET NULL;

-- Each person's thresholds on an account of theirs; NULL is no threshold.
-- low_below remembers the balance was announced below, until it is back above.
CREATE TABLE notification_thresholds (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    large_over INTEGER,
    low_under  INTEGER,
    low_below  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, account_id)
);

-- The wallets a person hears nothing from; every other wallet is in.
CREATE TABLE notification_wallets_off (
    user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    wallet_id INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, wallet_id)
);

-- A person's notification settings that are not per event.
CREATE TABLE notification_settings (
    user_id         INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    amounts_outside INTEGER NOT NULL DEFAULT 1
);
