-- name: InsertPayee :one
INSERT INTO payees (wallet_id, name, default_category_id, default_payment_mode)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: GetPayee :one
SELECT * FROM payees WHERE id = ? LIMIT 1;

-- name: ListPayeesForWallet :many
SELECT * FROM payees WHERE wallet_id = ? ORDER BY name;

-- name: UpdatePayee :exec
UPDATE payees SET name = ?, default_category_id = ?, default_payment_mode = ? WHERE id = ?;

-- name: DeletePayee :exec
DELETE FROM payees WHERE id = ?;

-- name: ReassignTransactionPayee :exec
UPDATE transactions SET payee_id = ? WHERE payee_id = ?;

-- name: CountTransactionsWithPayee :one
SELECT COUNT(*) FROM transactions WHERE payee_id = ?;
