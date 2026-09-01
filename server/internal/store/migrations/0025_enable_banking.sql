-- Enable Banking (EU/PSD2) is a second bank-sync provider, on a
-- bring-your-own-credentials model: the user registers their own Enable Banking
-- application (free sandbox to build, their own production app later) and pastes
-- its app id + RSA private key. The private key is a secret — stored server-side,
-- never returned to the client. One application config per wallet.
CREATE TABLE bank_ebanking_config (
    wallet_id   INTEGER PRIMARY KEY REFERENCES wallets (id) ON DELETE CASCADE,
    app_id      TEXT    NOT NULL,
    private_key TEXT    NOT NULL,
    environment TEXT    NOT NULL DEFAULT 'sandbox',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Pending Enable Banking authorizations, keyed by the random state we send to the
-- provider and receive back on the redirect. Short-lived; consumed on callback.
CREATE TABLE bank_ebanking_auth (
    state         TEXT    PRIMARY KEY,
    wallet_id     INTEGER NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
    aspsp_name    TEXT    NOT NULL,
    aspsp_country TEXT    NOT NULL,
    name          TEXT    NOT NULL DEFAULT '',
    redirect_url  TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_ebanking_auth_wallet ON bank_ebanking_auth (wallet_id);

-- Enable Banking connections reuse bank_connections (provider = 'enablebanking',
-- access_url = the session id). These columns carry the provider/consent metadata.
ALTER TABLE bank_connections ADD COLUMN aspsp_name    TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_connections ADD COLUMN aspsp_country TEXT NOT NULL DEFAULT '';
ALTER TABLE bank_connections ADD COLUMN valid_until   TEXT NOT NULL DEFAULT '';
