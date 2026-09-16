-- name: InsertValuation :one
INSERT INTO asset_valuations (account_id, date, value, note)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: GetValuation :one
SELECT * FROM asset_valuations WHERE id = ? LIMIT 1;

-- name: ListValuationsForAccount :many
SELECT * FROM asset_valuations WHERE account_id = ? ORDER BY date DESC, id DESC;

-- name: UpdateValuation :exec
UPDATE asset_valuations SET date = ?, value = ?, note = ? WHERE id = ?;

-- name: DeleteValuation :exec
DELETE FROM asset_valuations WHERE id = ?;

-- name: LatestValuationsForWallet :many
-- The most recent valuation (by date, then id) for each asset account in a wallet;
-- used to fold recorded values into net-worth totals.
SELECT v.account_id, v.value
FROM asset_valuations v
JOIN accounts a ON a.id = v.account_id
WHERE a.wallet_id = ?
  AND v.id = (
    SELECT v2.id FROM asset_valuations v2
    WHERE v2.account_id = v.account_id
    ORDER BY v2.date DESC, v2.id DESC
    LIMIT 1
  );
