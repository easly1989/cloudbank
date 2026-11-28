-- Passkeys (#798): WebAuthn credentials that sign a user in without the
-- password. credential holds the library's whole credential record as JSON,
-- written back after every sign-in (sign count, backup flags). rp_id is the
-- host the passkey was made on; it signs in only there. user_handle is one
-- random value per user, shared by all their passkeys.
CREATE TABLE passkeys (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    credential_id BLOB    NOT NULL UNIQUE,
    user_handle   BLOB    NOT NULL,
    rp_id         TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    credential    TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    last_used_at  TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_passkeys_user ON passkeys (user_id);
CREATE INDEX idx_passkeys_handle ON passkeys (user_handle);
