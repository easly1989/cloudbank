-- name: ListAIUnusualUsers :many
-- The people whose AI looks for unusual transactions (#700).
SELECT s.user_id, u.locale
FROM ai_settings s
JOIN users u ON u.id = s.user_id
WHERE s.enabled = 1 AND s.unusual_on = 1
ORDER BY s.user_id;

-- name: GetAIUnusualScan :one
SELECT last_txn, body, model, feedback, written_at
FROM ai_unusual_scans WHERE user_id = ? AND wallet_id = ?;

-- name: SetAIUnusualScanned :exec
INSERT INTO ai_unusual_scans (user_id, wallet_id, last_txn) VALUES (?, ?, ?)
ON CONFLICT (user_id, wallet_id) DO UPDATE SET last_txn = excluded.last_txn;

-- name: SetAIUnusualBody :exec
UPDATE ai_unusual_scans SET body = ?, model = ?, feedback = 0, written_at = ?
WHERE user_id = ? AND wallet_id = ?;

-- name: SetAIUnusualFeedback :execrows
UPDATE ai_unusual_scans SET feedback = ?
WHERE user_id = ? AND wallet_id = ? AND body <> '';

-- name: MaxWalletTransactionID :one
SELECT CAST(COALESCE(MAX(id), 0) AS INTEGER) FROM transactions WHERE wallet_id = ?;

-- name: ListUnusualExpenses :many
-- A wallet's expenses since a day, transfers left out, oldest first: who and
-- what wrote them, the payee and the account's currency.
SELECT t.id, t.account_id, t.date, t.amount, t.payee_id, COALESCE(p.name, '') AS payee,
    t.origin, t.created_by, a.currency_id
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN payees p ON p.id = t.payee_id
WHERE t.wallet_id = sqlc.arg(wallet_id) AND t.amount < 0 AND t.payment_mode <> 5
  AND t.date >= sqlc.arg(from_date)
ORDER BY t.date, t.id;

-- name: CountPayeeTransactions :many
-- How many transactions, of any date and sign, each payee of a wallet has.
SELECT CAST(payee_id AS INTEGER) AS payee_id, COUNT(*) AS n
FROM transactions
WHERE wallet_id = ? AND payee_id IS NOT NULL
GROUP BY payee_id;

-- name: InsertAIUnusual :one
INSERT INTO ai_unusual (user_id, wallet_id, transaction_id, kind, other_id, amount, usual, payments)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, transaction_id) DO NOTHING
RETURNING id;

-- name: ReopenAIUnusual :exec
-- An expense put away as fine is flagged again once its amount has changed.
UPDATE ai_unusual
SET state = 'open', kind = sqlc.arg(kind), other_id = sqlc.arg(other_id), amount = sqlc.arg(amount),
    usual = sqlc.arg(usual), payments = sqlc.arg(payments),
    created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id = sqlc.arg(user_id) AND transaction_id = sqlc.arg(transaction_id)
  AND state = 'fine' AND amount <> sqlc.arg(amount);

-- name: ListOpenAIUnusual :many
-- The expenses flagged and not handled, flagged since a moment, newest first.
-- A double whose pair was merged or marked not a duplicate on Review is gone.
SELECT f.id, f.transaction_id, f.kind, f.usual, f.payments,
    t.account_id, t.date, t.amount, COALESCE(p.name, '') AS payee, a.currency_id,
    CAST(COALESCE(f.other_id, 0) AS INTEGER) AS other_id, COALESCE(o.date, '') AS other_date
FROM ai_unusual f
JOIN transactions t ON t.id = f.transaction_id
JOIN accounts a ON a.id = t.account_id
LEFT JOIN payees p ON p.id = t.payee_id
LEFT JOIN transactions o ON o.id = f.other_id
WHERE f.user_id = sqlc.arg(user_id) AND f.wallet_id = sqlc.arg(wallet_id) AND f.state = 'open'
  AND f.created_at >= sqlc.arg(since)
  AND (f.kind <> 'double' OR (o.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM duplicate_dismissals d
    WHERE d.wallet_id = f.wallet_id
      AND d.txn_a_id = MIN(f.transaction_id, f.other_id)
      AND d.txn_b_id = MAX(f.transaction_id, f.other_id))))
ORDER BY t.date DESC, f.id DESC;

-- name: SetAIUnusualFine :execrows
UPDATE ai_unusual SET state = 'fine'
WHERE id = ? AND user_id = ? AND wallet_id = ? AND state = 'open';
