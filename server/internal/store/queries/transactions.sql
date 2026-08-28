-- name: InsertTransaction :one
INSERT INTO transactions (
    wallet_id, account_id, date, amount, payment_mode, status, info,
    payee_id, category_id, memo, is_split, import_ref, vehicle_id
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: ListImportRefsForAccount :many
SELECT DISTINCT import_ref
FROM transactions
WHERE account_id = ? AND import_ref <> '';

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

-- name: ListAccountRegister :many
-- The full account ledger ordered chronologically (date, then id) with a
-- server-computed cumulative delta. The application adds the account's initial
-- balance to produce each row's running balance.
SELECT
    t.id, t.account_id, t.date, t.amount, t.payment_mode, t.status, t.info,
    t.payee_id, t.category_id, t.memo, t.is_split, t.created_at, t.updated_at,
    p.name AS payee_name,
    c.name AS category_name,
    tr.id AS transfer_id,
    ot.account_id AS transfer_account_id,
    COALESCE((SELECT group_concat(tg.name, ',') FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id), '') AS tags,
    (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = t.id) AS attachment_count,
    CAST(SUM(t.amount) OVER (ORDER BY t.date, t.id ROWS UNBOUNDED PRECEDING) AS INTEGER) AS running_delta
FROM transactions t
LEFT JOIN payees p ON p.id = t.payee_id
LEFT JOIN categories c ON c.id = t.category_id
LEFT JOIN transfers tr ON tr.txn_from_id = t.id OR tr.txn_to_id = t.id
LEFT JOIN transactions ot ON ot.id = (CASE WHEN tr.txn_from_id = t.id THEN tr.txn_to_id ELSE tr.txn_from_id END)
WHERE t.account_id = ?
ORDER BY t.date, t.id;

-- name: CountTransactionsForAccount :one
SELECT COUNT(*) FROM transactions WHERE account_id = ?;

-- name: UpdateTransaction :exec
UPDATE transactions SET
    date = ?, amount = ?, payment_mode = ?, status = ?, info = ?,
    payee_id = ?, category_id = ?, memo = ?, is_split = ?, vehicle_id = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: UpdateTransactionStatus :exec
UPDATE transactions SET
    status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: SetTransactionCategory :exec
UPDATE transactions SET
    category_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: SetTransactionPayee :exec
UPDATE transactions SET
    payee_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: SetTransactionPaymentMode :exec
UPDATE transactions SET
    payment_mode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: SetTransactionInfo :exec
UPDATE transactions SET
    info = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: SetTransactionTemplate :exec
UPDATE transactions SET template_id = ? WHERE id = ?;

-- name: DeleteTransaction :exec
DELETE FROM transactions WHERE id = ?;

-- name: FindDuplicateTransactions :many
SELECT * FROM transactions
WHERE account_id = ? AND amount = ? AND date >= ? AND date <= ?
ORDER BY date DESC;

-- name: SearchTransactions :many
-- Wallet-wide register search: case-insensitive substring match of @q against
-- memo, info, payee name, category name and tag names (INSTR/LOWER, mirroring
-- the client-side filter), with optional account / date / amount / status
-- filters. Each row also carries the total match count (window) so the caller
-- can paginate.
SELECT t.id, t.account_id, t.date, t.amount, t.payment_mode, t.status, t.info,
       t.payee_id, t.category_id, t.memo, t.is_split, t.created_at, t.updated_at,
       a.name AS account_name,
       p.name AS payee_name,
       c.name AS category_name,
       COALESCE((SELECT group_concat(tg.name, ',') FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id), '') AS tags,
       CAST(COUNT(*) OVER () AS INTEGER) AS total_count
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN payees p ON p.id = t.payee_id
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND (sqlc.arg(account_id) = 0 OR t.account_id = sqlc.arg(account_id))
  AND (sqlc.arg(from_date) = '' OR t.date >= sqlc.arg(from_date))
  AND (sqlc.arg(to_date) = '' OR t.date <= sqlc.arg(to_date))
  AND (sqlc.arg(status) = -1 OR t.status = sqlc.arg(status))
  AND (sqlc.arg(amount_min_set) = 0 OR t.amount >= sqlc.arg(amount_min))
  AND (sqlc.arg(amount_max_set) = 0 OR t.amount <= sqlc.arg(amount_max))
  AND (
    INSTR(LOWER(t.memo), LOWER(sqlc.arg(q))) > 0
    OR INSTR(LOWER(t.info), LOWER(sqlc.arg(q))) > 0
    OR INSTR(LOWER(p.name), LOWER(sqlc.arg(q))) > 0
    OR INSTR(LOWER(c.name), LOWER(sqlc.arg(q))) > 0
    OR EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
               WHERE tt.transaction_id = t.id AND INSTR(LOWER(tg.name), LOWER(sqlc.arg(q))) > 0)
  )
ORDER BY t.date DESC, t.id DESC
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);
