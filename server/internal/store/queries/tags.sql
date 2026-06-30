-- name: GetTagByName :one
SELECT * FROM tags WHERE wallet_id = ? AND name = ? LIMIT 1;

-- name: InsertTag :one
INSERT INTO tags (wallet_id, name) VALUES (?, ?) RETURNING *;

-- name: ListTagsForWallet :many
SELECT * FROM tags WHERE wallet_id = ? ORDER BY name;

-- name: GetTag :one
SELECT * FROM tags WHERE id = ? LIMIT 1;

-- name: ListTagsWithCounts :many
SELECT t.id, t.name, COUNT(tt.transaction_id) AS count
FROM tags t
LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
WHERE t.wallet_id = ?
GROUP BY t.id, t.name
ORDER BY t.name;

-- name: RenameTag :exec
UPDATE tags SET name = ? WHERE id = ?;

-- name: ReassignTag :exec
-- Move tag references onto another tag; OR IGNORE skips rows where the target
-- tag is already present on that transaction (those source rows go away when the
-- source tag is deleted).
UPDATE OR IGNORE transaction_tags SET tag_id = ? WHERE tag_id = ?;

-- name: DeleteTag :exec
DELETE FROM tags WHERE id = ?;

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
