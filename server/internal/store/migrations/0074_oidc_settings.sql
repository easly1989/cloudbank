-- Single sign-on set from Settings › Security (#796), for an installation
-- whose CB_OIDC_* variables are not set (the variables always win). One row at
-- most. client_secret is sealed with internal/secrets: it is saved only when
-- CB_SECRET_KEY is set, and the API never returns it.
CREATE TABLE oidc_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  issuer         TEXT    NOT NULL,
  client_id      TEXT    NOT NULL,
  client_secret  TEXT    NOT NULL,
  redirect_url   TEXT    NOT NULL,
  scopes         TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  auto_provision INTEGER NOT NULL DEFAULT 0,
  admin_email    TEXT    NOT NULL DEFAULT '',
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
