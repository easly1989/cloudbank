-- name: InsertAssignment :one
INSERT INTO assignments (
    wallet_id, position, match_field, match_type, pattern, case_sensitive,
    set_payee_id, set_category_id, set_payment_mode, apply_on_manual, apply_on_import
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetAssignment :one
SELECT * FROM assignments WHERE id = ? LIMIT 1;

-- name: ListAssignmentsForWallet :many
SELECT * FROM assignments WHERE wallet_id = ? ORDER BY position, id;

-- name: NextAssignmentPosition :one
SELECT CAST(COALESCE(MAX(position) + 1, 0) AS INTEGER) FROM assignments WHERE wallet_id = ?;

-- name: UpdateAssignment :exec
UPDATE assignments SET
    match_field = ?, match_type = ?, pattern = ?, case_sensitive = ?,
    set_payee_id = ?, set_category_id = ?, set_payment_mode = ?,
    apply_on_manual = ?, apply_on_import = ?
WHERE id = ?;

-- name: SetAssignmentPosition :exec
UPDATE assignments SET position = ? WHERE id = ? AND wallet_id = ?;

-- name: DeleteAssignment :exec
DELETE FROM assignments WHERE id = ?;

-- name: ListWalletTransactionsForRules :many
SELECT t.id, t.account_id, t.date, t.memo, t.payee_id, t.category_id, t.payment_mode,
       COALESCE(p.name, '') AS payee_name
FROM transactions t
LEFT JOIN payees p ON p.id = t.payee_id
WHERE t.wallet_id = ?
ORDER BY t.id;
