-- Two-factor authentication (TOTP). The base32 secret lives in the users row
-- (the app's trust boundary, like the password hash); totp_enabled gates login.
ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

-- One-time recovery codes, stored hashed (sha256), for logging in when the
-- authenticator is unavailable. used_at marks a consumed code.
CREATE TABLE mfa_recovery_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash  TEXT    NOT NULL,
    used_at    TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_mfa_recovery_user ON mfa_recovery_codes (user_id);
