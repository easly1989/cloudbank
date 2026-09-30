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

-- name: PayeeActivity :many
-- What each payee holds, per account currency: its transactions dated in
-- [from_date, to_date], their sum, and the latest one on or before to_date.
-- The caller adds the currencies up.
SELECT t.payee_id AS payee_id,
       a.currency_id AS currency_id,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN 1 ELSE 0 END) AS INTEGER) AS txn_count,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN t.amount ELSE 0 END) AS INTEGER) AS total,
       CAST(MAX(t.date) AS TEXT) AS last_date
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.payee_id IS NOT NULL
  AND t.date <= sqlc.arg(to_date)
GROUP BY t.payee_id, a.currency_id;

-- name: PayeeCategoryCounts :many
-- How often each payee's plain transactions in the period went to each
-- category. A split has no one category, so it is left out.
SELECT payee_id, category_id, COUNT(*) AS txn_count
FROM transactions
WHERE wallet_id = sqlc.arg(wallet_id)
  AND payee_id IS NOT NULL
  AND is_split = 0
  AND category_id IS NOT NULL
  AND date >= sqlc.arg(from_date)
  AND date <= sqlc.arg(to_date)
GROUP BY payee_id, category_id;

-- name: PayeePaymentCounts :many
-- How often each payee's transactions in the period used each payment mode,
-- "none" (0) left out.
SELECT payee_id, payment_mode, COUNT(*) AS txn_count
FROM transactions
WHERE wallet_id = sqlc.arg(wallet_id)
  AND payee_id IS NOT NULL
  AND payment_mode <> 0
  AND date >= sqlc.arg(from_date)
  AND date <= sqlc.arg(to_date)
GROUP BY payee_id, payment_mode;
