-- name: InsertCategory :one
INSERT INTO categories (wallet_id, parent_id, name, is_income, no_budget, no_report)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetCategory :one
SELECT * FROM categories WHERE id = ? LIMIT 1;

-- name: ListCategoriesForWallet :many
SELECT * FROM categories WHERE wallet_id = ? ORDER BY name;

-- name: UpdateCategory :exec
UPDATE categories SET parent_id = ?, name = ?, is_income = ?, no_budget = ?, no_report = ? WHERE id = ?;

-- name: SetChildrenIncome :exec
UPDATE categories SET is_income = ? WHERE parent_id = ?;

-- name: DeleteCategory :exec
DELETE FROM categories WHERE id = ?;

-- name: CountSubcategories :one
SELECT COUNT(*) FROM categories WHERE parent_id = ?;

-- name: ReparentChildren :exec
UPDATE categories SET parent_id = ? WHERE parent_id = ?;

-- name: CountPayeesWithCategory :one
SELECT COUNT(*) FROM payees WHERE default_category_id = ?;

-- name: ReassignPayeeCategory :exec
UPDATE payees SET default_category_id = ? WHERE default_category_id = ?;

-- name: ReassignTransactionCategory :exec
UPDATE transactions SET category_id = ? WHERE category_id = ?;

-- name: ReassignSplitCategory :exec
UPDATE splits SET category_id = ? WHERE category_id = ?;

-- name: CountTransactionsWithCategory :one
SELECT COUNT(*) FROM transactions WHERE category_id = ?;

-- name: CategoryActivity :many
-- What each category holds, per account currency: its lines dated in
-- [from_date, to_date], their sum, and the latest line on or before to_date.
-- Plain transactions and split lines are summed apart, so a category and
-- currency can come back twice; the caller adds them up. A split counts once
-- per line, under the line's own category. No category is left out, not even
-- one hidden from the reports.
SELECT t.category_id AS category_id,
       a.currency_id AS currency_id,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN 1 ELSE 0 END) AS INTEGER) AS line_count,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN t.amount ELSE 0 END) AS INTEGER) AS total,
       CAST(MAX(t.date) AS TEXT) AS last_date
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.is_split = 0
  AND t.category_id IS NOT NULL
  AND t.date <= sqlc.arg(to_date)
GROUP BY t.category_id, a.currency_id
UNION ALL
SELECT s.category_id AS category_id,
       a.currency_id AS currency_id,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN 1 ELSE 0 END) AS INTEGER) AS line_count,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN s.amount ELSE 0 END) AS INTEGER) AS total,
       CAST(MAX(t.date) AS TEXT) AS last_date
FROM splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND s.category_id IS NOT NULL
  AND t.date <= sqlc.arg(to_date)
GROUP BY s.category_id, a.currency_id;
