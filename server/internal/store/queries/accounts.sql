-- name: InsertAccount :one
INSERT INTO accounts (
    wallet_id, name, type, currency_id, institution, number,
    initial_balance, minimum_balance, closed, no_summary, no_budget, no_report,
    position, group_name, notes, website
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetAccount :one
SELECT * FROM accounts WHERE id = ? LIMIT 1;

-- name: ListAccountsForWallet :many
SELECT
    a.*,
    c.iso_code      AS currency_code,
    c.symbol        AS currency_symbol,
    c.symbol_prefix AS currency_symbol_prefix,
    c.decimal_char  AS currency_decimal_char,
    c.group_char    AS currency_group_char,
    c.frac_digits   AS currency_frac_digits
FROM accounts a
JOIN currencies c ON c.id = a.currency_id
WHERE a.wallet_id = ?
ORDER BY a.position, a.group_name, a.name;

-- name: AccountBalanceDelta :one
-- Today/future transaction sums for a single account; the caller adds the
-- account's initial balance. Mirrors AccountBalanceDeltas (the per-wallet form).
SELECT
    CAST(COALESCE(SUM(amount), 0) AS INTEGER) AS future_delta,
    CAST(COALESCE(SUM(CASE WHEN date <= sqlc.arg(today) THEN amount ELSE 0 END), 0) AS INTEGER) AS today_delta
FROM transactions
WHERE account_id = sqlc.arg(account_id);

-- name: NextAccountPosition :one
SELECT COALESCE(MAX(position), 0) + 1 FROM accounts WHERE wallet_id = ?;

-- name: UpdateAccount :exec
UPDATE accounts SET
    name = ?, type = ?, currency_id = ?, institution = ?, number = ?,
    initial_balance = ?, minimum_balance = ?, closed = ?,
    no_summary = ?, no_budget = ?, no_report = ?, group_name = ?, notes = ?, website = ?
WHERE id = ?;

-- name: UpdateAccountPosition :exec
UPDATE accounts SET position = ?, group_name = ? WHERE id = ?;

-- name: DeleteAccount :exec
DELETE FROM accounts WHERE id = ?;
