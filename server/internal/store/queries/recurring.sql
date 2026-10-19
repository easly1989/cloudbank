-- name: ListRecurringCandidates :many
-- What a recurring payment can be found in (#693): the wallet's transactions
-- with a payee in a date range, with their account's currency, leaving out
-- transfers, reminders and void ones, and the payees a schedule already pays.
SELECT t.date, t.amount, t.account_id, a.currency_id,
       CAST(t.payee_id AS INTEGER) AS payee_id, p.name AS payee_name
FROM transactions t
JOIN accounts a ON a.id = t.account_id
JOIN payees p ON p.id = t.payee_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.date >= sqlc.arg(from_date) AND t.date <= sqlc.arg(to_date)
  AND t.status NOT IN (3, 4)
  AND NOT EXISTS (SELECT 1 FROM transfers tr WHERE tr.txn_from_id = t.id OR tr.txn_to_id = t.id)
  AND NOT EXISTS (
      SELECT 1 FROM schedules sch
      JOIN templates tpl ON tpl.id = sch.template_id
      WHERE sch.wallet_id = t.wallet_id AND tpl.payee_id = t.payee_id
  )
ORDER BY t.payee_id, a.currency_id, t.date, t.id;

-- name: ListRecurringIgnored :many
SELECT payee_id, cadence FROM recurring_ignored WHERE wallet_id = ?;

-- name: InsertRecurringIgnored :exec
INSERT OR IGNORE INTO recurring_ignored (wallet_id, payee_id, cadence) VALUES (?, ?, ?);
