-- Personal API tokens: long-lived bearer credentials for programmatic API
-- access, scoped read or write. Like sessions, only the SHA-256 of the token is
-- stored, so a database leak exposes no usable token.
CREATE TABLE api_tokens (
    id           TEXT    PRIMARY KEY,            -- hex-encoded SHA-256 of the token
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    scope        TEXT    NOT NULL DEFAULT 'read', -- 'read' (safe methods) | 'write' (all)
    prefix       TEXT    NOT NULL DEFAULT '',     -- leading characters, shown so a token is recognizable
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_used_at TEXT,                            -- NULL until first use
    expires_at   TEXT                             -- NULL = never expires
);

CREATE INDEX idx_api_tokens_user ON api_tokens (user_id);
