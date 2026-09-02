-- name: InsertBankConnection :one
INSERT INTO bank_connections (wallet_id, provider, access_url, name)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: GetBankConnection :one
SELECT * FROM bank_connections WHERE id = ? LIMIT 1;

-- name: ListBankConnectionsForWallet :many
SELECT * FROM bank_connections WHERE wallet_id = ? ORDER BY created_at DESC, id;

-- name: DeleteBankConnection :execrows
DELETE FROM bank_connections WHERE id = ? AND wallet_id = ?;

-- name: TouchBankConnection :exec
UPDATE bank_connections SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;

-- name: SetBankConnectionAutoSync :execrows
UPDATE bank_connections SET auto_sync = ? WHERE id = ? AND wallet_id = ?;

-- name: ListDueBankConnections :many
SELECT id, wallet_id FROM bank_connections
WHERE auto_sync = 1 AND (last_synced_at IS NULL OR last_synced_at < ?)
ORDER BY last_synced_at IS NOT NULL, last_synced_at, id;

-- name: UpsertBankLink :exec
INSERT INTO bank_links (connection_id, external_id, account_id)
VALUES (?, ?, ?)
ON CONFLICT (connection_id, external_id) DO UPDATE SET account_id = excluded.account_id;

-- name: DeleteBankLink :exec
DELETE FROM bank_links WHERE connection_id = ? AND external_id = ?;

-- name: ListBankLinks :many
SELECT external_id, account_id FROM bank_links WHERE connection_id = ?;
