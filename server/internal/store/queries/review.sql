-- name: ListImportedUncategorized :many
-- Bank-imported transactions (they carry an import ref) that still have no
-- category, so the review can prompt the user to complete them. Split
-- transactions carry their categories on the splits, so they are excluded.
SELECT *
FROM transactions
WHERE wallet_id = ? AND import_ref <> '' AND category_id IS NULL AND is_split = 0
ORDER BY date DESC, id DESC;

-- name: ListPotentialDuplicates :many
-- Transactions that share account + amount with at least one other in the wallet.
-- Pairing by date proximity and filtering out dismissed pairs is done in Go.
SELECT t.*
FROM transactions t
JOIN (
    SELECT g0.account_id AS account_id, g0.amount AS amount
    FROM transactions g0
    WHERE g0.wallet_id = ?
    GROUP BY g0.account_id, g0.amount
    HAVING COUNT(*) > 1
) g ON t.account_id = g.account_id AND t.amount = g.amount
WHERE t.wallet_id = ?
ORDER BY t.account_id, t.amount, t.date, t.id;

-- name: InsertDuplicateDismissal :exec
INSERT INTO duplicate_dismissals (wallet_id, txn_a_id, txn_b_id)
VALUES (?, ?, ?)
ON CONFLICT DO NOTHING;

-- name: ListDuplicateDismissals :many
SELECT txn_a_id, txn_b_id FROM duplicate_dismissals WHERE wallet_id = ?;

-- name: SetTransactionImportRef :exec
UPDATE transactions SET import_ref = ? WHERE id = ? AND wallet_id = ?;
