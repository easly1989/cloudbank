-- name: ListImportedUncategorized :many
-- Bank-imported transactions (they carry an import ref) that still have no
-- category, so the review can prompt the user to complete them. Split
-- transactions carry their categories on the splits, so they are excluded.
SELECT *
FROM transactions
WHERE wallet_id = ? AND import_ref <> '' AND category_id IS NULL AND is_split = 0
ORDER BY date DESC, id DESC;

-- name: InsertDuplicateDismissal :exec
INSERT INTO duplicate_dismissals (wallet_id, txn_a_id, txn_b_id)
VALUES (?, ?, ?)
ON CONFLICT DO NOTHING;

-- name: ListDuplicateDismissals :many
SELECT txn_a_id, txn_b_id FROM duplicate_dismissals WHERE wallet_id = ?;

-- name: SetTransactionImportRef :exec
UPDATE transactions SET import_ref = ? WHERE id = ? AND wallet_id = ?;

-- name: ListDuplicateCandidates :many
-- Every transaction of the wallet, reduced to what the duplicate finder compares
-- and ordered for it: by account, amount, then date. The account/date index
-- holds all four columns, so this reads no table rows (#541).
SELECT n.id, n.account_id, n.amount, n.date
FROM accounts a
JOIN transactions n ON n.account_id = a.id
WHERE a.wallet_id = ?
ORDER BY n.account_id, n.amount, n.date, n.id;

-- name: ListTransactionsByIDs :many
SELECT * FROM transactions
WHERE wallet_id = sqlc.arg(wallet_id) AND id IN (sqlc.slice(ids));
