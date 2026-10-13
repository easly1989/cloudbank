-- Access recovery codes (#620): when the server signs in through SSO only
-- (CB_PASSWORD_LOGIN=false), each user can keep ten one-time codes that let
-- them in while the identity provider is down. Kept apart from the 2FA
-- recovery codes, which finish a password login, so neither set can stand in
-- for the other. Only the hash of each code is stored.
CREATE TABLE access_recovery_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash  TEXT    NOT NULL,
    used_at    TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_access_recovery_user ON access_recovery_codes (user_id);
