-- name: InsertAttachment :one
INSERT INTO attachments (wallet_id, transaction_id, filename, content_type, size, storage_key)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetAttachment :one
SELECT * FROM attachments WHERE id = ? LIMIT 1;

-- name: ListAttachmentsForTransaction :many
SELECT * FROM attachments WHERE transaction_id = ? ORDER BY id;

-- name: ListAttachmentsForWallet :many
SELECT * FROM attachments WHERE wallet_id = ? ORDER BY id;

-- name: DeleteAttachment :exec
DELETE FROM attachments WHERE id = ?;
