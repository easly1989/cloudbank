-- name: UpsertEBankingConfig :exec
INSERT INTO bank_ebanking_config (wallet_id, app_id, private_key, environment)
VALUES (?, ?, ?, ?)
ON CONFLICT (wallet_id) DO UPDATE SET
    app_id = excluded.app_id,
    private_key = excluded.private_key,
    environment = excluded.environment,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- name: GetEBankingConfig :one
SELECT * FROM bank_ebanking_config WHERE wallet_id = ? LIMIT 1;

-- name: DeleteEBankingConfig :execrows
DELETE FROM bank_ebanking_config WHERE wallet_id = ?;

-- name: InsertEBankingAuth :exec
INSERT INTO bank_ebanking_auth (state, wallet_id, aspsp_name, aspsp_country, name, redirect_url, connection_id)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: GetEBankingAuth :one
SELECT * FROM bank_ebanking_auth WHERE state = ? LIMIT 1;

-- name: DeleteEBankingAuth :exec
DELETE FROM bank_ebanking_auth WHERE state = ?;

-- name: DeleteStaleEBankingAuth :exec
DELETE FROM bank_ebanking_auth
WHERE wallet_id = ? AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour');

-- name: InsertEBankingConnection :one
INSERT INTO bank_connections (wallet_id, provider, access_url, name, aspsp_name, aspsp_country, valid_until, accounts_json)
VALUES (?, 'enablebanking', ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: RefreshEBankingConnectionSession :one
UPDATE bank_connections
SET access_url = ?, valid_until = ?, accounts_json = ?
WHERE id = ? AND wallet_id = ? AND provider = 'enablebanking'
RETURNING *;
