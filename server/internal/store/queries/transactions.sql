-- name: InsertTransaction :one
INSERT INTO transactions (
    wallet_id, account_id, date, amount, payment_mode, status, info,
    payee_id, category_id, memo, is_split
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetTransaction :one
SELECT * FROM transactions WHERE id = ? LIMIT 1;

-- name: ListTransactionsForAccount :many
SELECT t.*, p.name AS payee_name, c.name AS category_name
FROM transactions t
LEFT JOIN payees p ON p.id = t.payee_id
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.account_id = ?
ORDER BY t.date DESC, t.id DESC
LIMIT ? OFFSET ?;

-- name: CountTransactionsForAccount :one
SELECT COUNT(*) FROM transactions WHERE account_id = ?;

-- name: UpdateTransaction :exec
UPDATE transactions SET
    date = ?, amount = ?, payment_mode = ?, status = ?, info = ?,
    payee_id = ?, category_id = ?, memo = ?, is_split = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: DeleteTransaction :exec
DELETE FROM transactions WHERE id = ?;

-- name: FindDuplicateTransactions :many
SELECT * FROM transactions
WHERE account_id = ? AND amount = ? AND date >= ? AND date <= ?
ORDER BY date DESC;
