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

-- name: ListAccountTransactionTags :many
-- Every tag on an account's transactions in one pass, for the exports: by
-- transaction, then by name, as ListTransactionTags orders one transaction's.
SELECT tt.transaction_id, t.name
FROM transaction_tags tt
JOIN tags t ON t.id = tt.tag_id
JOIN transactions x ON x.id = tt.transaction_id
WHERE x.account_id = ?
ORDER BY tt.transaction_id, t.name;

-- name: AddTransactionTag :exec
INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)
ON CONFLICT DO NOTHING;

-- name: DeleteTransactionTags :exec
DELETE FROM transaction_tags WHERE transaction_id = ?;

-- name: TagActivity :many
-- What each tag holds, per account currency: its transactions dated in
-- [from_date, to_date], their sum, and the latest one on or before to_date.
-- The caller adds the currencies up.
SELECT tt.tag_id AS tag_id,
       a.currency_id AS currency_id,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN 1 ELSE 0 END) AS INTEGER) AS txn_count,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN t.amount ELSE 0 END) AS INTEGER) AS total,
       CAST(MAX(t.date) AS TEXT) AS last_date
FROM transaction_tags tt
JOIN transactions t ON t.id = tt.transaction_id
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.date <= sqlc.arg(to_date)
GROUP BY tt.tag_id, a.currency_id;

-- name: TagCategoryCounts :many
-- The categories a tag's transactions in the period went to, and how often:
-- a plain transaction under its category, a split once per line under the
-- line's. The two halves can name the same pair; the caller adds them up.
SELECT tt.tag_id AS tag_id, t.category_id AS category_id, COUNT(*) AS txn_count
FROM transaction_tags tt
JOIN transactions t ON t.id = tt.transaction_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.is_split = 0
  AND t.category_id IS NOT NULL
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date)
GROUP BY tt.tag_id, t.category_id
UNION ALL
SELECT tt.tag_id AS tag_id, s.category_id AS category_id, COUNT(*) AS txn_count
FROM transaction_tags tt
JOIN transactions t ON t.id = tt.transaction_id
JOIN splits s ON s.transaction_id = t.id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND s.category_id IS NOT NULL
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date)
GROUP BY tt.tag_id, s.category_id;
