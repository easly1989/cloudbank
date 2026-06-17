-- name: ListBudgetsForWallet :many
SELECT * FROM budgets WHERE wallet_id = ? ORDER BY category_id, month;

-- name: DeleteCategoryBudget :exec
DELETE FROM budgets WHERE wallet_id = ? AND category_id = ?;

-- name: InsertBudget :exec
INSERT INTO budgets (wallet_id, category_id, month, amount) VALUES (?, ?, ?, ?);

-- name: CategoryActualsForBudget :many
-- Category amounts in a date range (plain transactions + split lines), excluding
-- accounts flagged no_budget, with each row's currency so the app can convert.
SELECT t.category_id AS category_id, t.amount AS amount, a.currency_id AS currency_id
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.is_split = 0
  AND t.category_id IS NOT NULL
  AND a.no_budget = 0
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date)
UNION ALL
SELECT s.category_id AS category_id, s.amount AS amount, a.currency_id AS currency_id
FROM splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND s.category_id IS NOT NULL
  AND a.no_budget = 0
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date);
