-- OIDC/SSO identities: link an external identity provider's (issuer, subject)
-- to a local user, so a user can sign in through OIDC in addition to (or instead
-- of) a local password. Kept in a side table rather than columns on `users` so a
-- user can hold multiple identities and the users schema is untouched. The
-- (issuer, subject) pair is globally unique (one external identity → one user).
CREATE TABLE user_oidc_identities (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer     TEXT NOT NULL,
  subject    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX idx_user_oidc_identities_user ON user_oidc_identities(user_id);
