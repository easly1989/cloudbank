-- name: ListVehicleTransactions :many
-- Fuel transactions linked to a vehicle in a date range, with the account
-- currency so costs can be converted to base. Ordered for sequential odometer
-- processing.
SELECT t.id, t.date, t.memo, t.amount, a.currency_id
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.wallet_id = ?
  AND t.vehicle_id = ?
  AND t.is_split = 0
  AND t.date >= ?
  AND t.date <= ?
ORDER BY t.date, t.id;
