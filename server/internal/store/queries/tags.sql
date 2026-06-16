-- name: GetTagByName :one
SELECT * FROM tags WHERE wallet_id = ? AND name = ? LIMIT 1;

-- name: InsertTag :one
INSERT INTO tags (wallet_id, name) VALUES (?, ?) RETURNING *;

-- name: ListTagsForWallet :many
SELECT * FROM tags WHERE wallet_id = ? ORDER BY name;

-- name: ListTransactionTags :many
SELECT t.name
FROM transaction_tags tt
JOIN tags t ON t.id = tt.tag_id
WHERE tt.transaction_id = ?
ORDER BY t.name;

-- name: AddTransactionTag :exec
INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)
ON CONFLICT DO NOTHING;

-- name: DeleteTransactionTags :exec
DELETE FROM transaction_tags WHERE transaction_id = ?;
