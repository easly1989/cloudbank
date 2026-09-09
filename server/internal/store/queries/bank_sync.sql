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

-- name: RecordBankSyncOutcome :exec
UPDATE bank_connections
SET last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_sync_status = ?, last_sync_message = ?
WHERE id = ?;

-- name: SetBankConnectionAutoSync :execrows
UPDATE bank_connections SET auto_sync = ? WHERE id = ? AND wallet_id = ?;

-- name: SetBankConnectionSchedule :execrows
UPDATE bank_connections SET sync_hour = ?, sync_days = ? WHERE id = ? AND wallet_id = ?;

-- name: ListAutoSyncConnections :many
-- Every connection with auto-sync on, plus its schedule (hour + weekday bitmask)
-- and last successful sync. The caller decides which are due for the current time
-- in Go, so the day/hour arithmetic stays testable and out of SQL.
SELECT id, wallet_id, sync_hour, sync_days, last_synced_at FROM bank_connections
WHERE auto_sync = 1
ORDER BY last_synced_at IS NOT NULL, last_synced_at, id;

-- name: InsertBankSyncRun :exec
INSERT INTO bank_sync_runs (connection_id, ran_at, triggered_by, status, imported, reconciled, message, accounts_json)
VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?, ?, ?, ?);

-- name: ListBankSyncRuns :many
SELECT * FROM bank_sync_runs WHERE connection_id = ? ORDER BY id DESC LIMIT ?;

-- name: PruneBankSyncRuns :exec
DELETE FROM bank_sync_runs
WHERE bank_sync_runs.connection_id = ?
  AND bank_sync_runs.id NOT IN (
    SELECT r.id FROM bank_sync_runs r WHERE r.connection_id = ? ORDER BY r.id DESC LIMIT ?
  );

-- name: UpsertBankLink :exec
INSERT INTO bank_links (connection_id, external_id, account_id)
VALUES (?, ?, ?)
ON CONFLICT (connection_id, external_id) DO UPDATE SET account_id = excluded.account_id;

-- name: DeleteBankLink :exec
DELETE FROM bank_links WHERE connection_id = ? AND external_id = ?;

-- name: ListBankLinks :many
SELECT external_id, account_id FROM bank_links WHERE connection_id = ?;
