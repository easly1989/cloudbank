-- name: InsertSplit :exec
INSERT INTO splits (transaction_id, category_id, amount, memo, position)
VALUES (?, ?, ?, ?, ?);

-- name: ListSplits :many
SELECT * FROM splits WHERE transaction_id = ? ORDER BY position, id;

-- name: DeleteSplits :exec
DELETE FROM splits WHERE transaction_id = ?;
