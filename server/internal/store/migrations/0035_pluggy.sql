-- Pluggy (Latin America) is a third bank-sync provider, on the same
-- bring-your-own-credentials model as the other two: the user registers their
-- own Pluggy application and pastes its client id + secret. The secret is a
-- secret — stored server-side, never returned to the client. One application
-- config per wallet.
--
-- Banks themselves are linked outside CloudBank, in Pluggy's own consumer app
-- (Meu Pluggy), which hands back an "item" id per connected institution. So a
-- Pluggy connection reuses bank_connections with provider = 'pluggy' and
-- access_url = that item id; no widget and no OAuth callback are involved.
CREATE TABLE bank_pluggy_config (
    wallet_id     INTEGER PRIMARY KEY REFERENCES wallets (id) ON DELETE CASCADE,
    client_id     TEXT    NOT NULL,
    client_secret TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
