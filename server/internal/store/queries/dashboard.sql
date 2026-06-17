-- name: AccountBalanceDeltas :many
-- Per-account transaction sums using the same definitions as the register
-- header: future = all, today = dated on/before today, bank = cleared(1) or
-- reconciled(2). The application adds each account's initial balance.
SELECT
    account_id,
    CAST(SUM(amount) AS INTEGER) AS future_delta,
    CAST(SUM(CASE WHEN date <= sqlc.arg(today) THEN amount ELSE 0 END) AS INTEGER) AS today_delta,
    CAST(SUM(CASE WHEN status IN (1, 2) THEN amount ELSE 0 END) AS INTEGER) AS bank_delta
FROM transactions
WHERE wallet_id = sqlc.arg(wallet_id)
GROUP BY account_id;

-- name: CategoryExpenseTotals :many
-- Category amounts in a date range, from both plain transactions and split
-- lines, with each row's account currency so the app can convert to base.
SELECT t.category_id AS category_id, t.amount AS amount, a.currency_id AS currency_id
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.is_split = 0
  AND t.category_id IS NOT NULL
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date)
UNION ALL
SELECT s.category_id AS category_id, s.amount AS amount, a.currency_id AS currency_id
FROM splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND s.category_id IS NOT NULL
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date);
