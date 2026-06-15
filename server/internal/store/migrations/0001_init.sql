-- Users are created by an admin; there is no self-registration. The first user
-- created via the setup wizard is the admin.
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL,
    email         TEXT    NOT NULL DEFAULT '',
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    locale        TEXT    NOT NULL DEFAULT 'en',
    theme         TEXT    NOT NULL DEFAULT 'auto',
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_users_username ON users (username);

-- Sessions store only the SHA-256 hash of the opaque token, never the token.
CREATE TABLE sessions (
    id           TEXT    PRIMARY KEY,            -- hex-encoded SHA-256 of the token
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at   TEXT    NOT NULL,
    last_seen_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    user_agent   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- A wallet is the equivalent of a HomeBank .xhb file: a fully isolated set of
-- accounts, transactions, categories, etc. base_currency_id references the
-- currencies table introduced in the currencies milestone.
CREATE TABLE wallets (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT    NOT NULL,
    owner_name        TEXT    NOT NULL DEFAULT '',
    base_currency_id  INTEGER,
    settings_json     TEXT    NOT NULL DEFAULT '{}',
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Membership grants a user access to a wallet. The wallet-isolation middleware
-- consults this table on every wallet-scoped request.
CREATE TABLE wallet_members (
    wallet_id INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
    role      TEXT    NOT NULL DEFAULT 'owner',         -- 'owner' | 'member'
    PRIMARY KEY (wallet_id, user_id)
);

CREATE INDEX idx_wallet_members_user ON wallet_members (user_id);
