-- name: InsertTransfer :one
INSERT INTO transfers (txn_from_id, txn_to_id) VALUES (?, ?) RETURNING *;

-- name: GetTransfer :one
SELECT * FROM transfers WHERE id = ? LIMIT 1;

-- name: GetTransferByTransaction :one
SELECT * FROM transfers WHERE txn_from_id = ? OR txn_to_id = ? LIMIT 1;

-- name: DeleteTransfer :exec
DELETE FROM transfers WHERE id = ?;
