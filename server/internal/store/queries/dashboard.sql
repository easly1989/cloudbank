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
  AND t.category_id NOT IN (SELECT cc.id FROM categories cc LEFT JOIN categories pp ON pp.id = cc.parent_id WHERE cc.wallet_id = sqlc.arg(wallet_id) AND (cc.no_report = 1 OR pp.no_report = 1))
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date)
UNION ALL
SELECT s.category_id AS category_id, s.amount AS amount, a.currency_id AS currency_id
FROM splits s
JOIN transactions t ON t.id = s.transaction_id
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND s.category_id IS NOT NULL
  AND s.category_id NOT IN (SELECT cc.id FROM categories cc LEFT JOIN categories pp ON pp.id = cc.parent_id WHERE cc.wallet_id = sqlc.arg(wallet_id) AND (cc.no_report = 1 OR pp.no_report = 1))
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date);

-- name: PayeeExpenseTotals :many
-- Payee amounts in a date range. Payee is a per-transaction attribute, so split
-- transactions contribute via their parent's total amount; each row carries the
-- account currency so the app can convert to base.
SELECT t.payee_id AS payee_id, t.amount AS amount, a.currency_id AS currency_id
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.payee_id IS NOT NULL
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date);

-- name: MonthlyIncomeExpense :many
-- Per-month income (amount > 0) and expense (amount < 0) totals in a date range,
-- excluding internal transfers (payment_mode 5), with each row's account
-- currency for base conversion. Drives the dashboard income/expense chart.
SELECT CAST(strftime('%Y-%m', t.date) AS TEXT) AS month, a.currency_id AS currency_id,
       CAST(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) AS INTEGER) AS income,
       CAST(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END) AS INTEGER) AS expense
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.payment_mode <> 5
  AND (t.category_id IS NULL OR t.category_id NOT IN (SELECT cc.id FROM categories cc LEFT JOIN categories pp ON pp.id = cc.parent_id WHERE cc.wallet_id = sqlc.arg(wallet_id) AND (cc.no_report = 1 OR pp.no_report = 1)))
  AND t.date >= sqlc.arg(from_date)
  AND t.date <= sqlc.arg(to_date)
GROUP BY month, a.currency_id;
