-- name: InsertAssignment :one
INSERT INTO assignments (
    wallet_id, position, match_field, match_type, pattern, case_sensitive, match_account_id,
    set_payee_id, set_category_id, set_payment_mode, set_info, apply_on_manual, apply_on_import
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetAssignment :one
SELECT * FROM assignments WHERE id = ? LIMIT 1;

-- name: ListAssignmentsForWallet :many
SELECT * FROM assignments WHERE wallet_id = ? ORDER BY position, id;

-- name: NextAssignmentPosition :one
SELECT CAST(COALESCE(MAX(position) + 1, 0) AS INTEGER) FROM assignments WHERE wallet_id = ?;

-- name: UpdateAssignment :exec
UPDATE assignments SET
    match_field = ?, match_type = ?, pattern = ?, case_sensitive = ?, match_account_id = ?,
    set_payee_id = ?, set_category_id = ?, set_payment_mode = ?, set_info = ?,
    apply_on_manual = ?, apply_on_import = ?
WHERE id = ?;

-- name: SetAssignmentPosition :exec
UPDATE assignments SET position = ? WHERE id = ? AND wallet_id = ?;

-- name: DeleteAssignment :exec
DELETE FROM assignments WHERE id = ?;

-- name: ListWalletTransactionsForRules :many
-- Every transaction with what a rule can read (memo, payee, tags, account) and
-- what it can fill in. The tags come joined by the unit separator (char 31),
-- which no tag name holds.
SELECT t.id, t.account_id, t.date, t.memo, t.info, t.payee_id, t.category_id, t.payment_mode,
       COALESCE(p.name, '') AS payee_name,
       CAST(COALESCE((SELECT group_concat(g.name, char(31))
                      FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
                      WHERE tt.transaction_id = t.id), '') AS TEXT) AS tag_names
FROM transactions t
LEFT JOIN payees p ON p.id = t.payee_id
WHERE t.wallet_id = ?
ORDER BY t.id;

-- name: ListAssignmentTagsForWallet :many
-- The tags every rule of the wallet adds, by rule then name.
SELECT at.assignment_id, g.id AS tag_id, g.name
FROM assignment_tags at
JOIN assignments a ON a.id = at.assignment_id
JOIN tags g ON g.id = at.tag_id
WHERE a.wallet_id = ?
ORDER BY at.assignment_id, g.name;

-- name: AddAssignmentTag :exec
INSERT INTO assignment_tags (assignment_id, tag_id) VALUES (?, ?)
ON CONFLICT DO NOTHING;

-- name: DeleteAssignmentTags :exec
DELETE FROM assignment_tags WHERE assignment_id = ?;

-- name: ReassignAssignmentTag :exec
-- A tag merge moves the rules too; OR IGNORE skips a rule that already adds
-- the target (its row goes away with the source tag).
UPDATE OR IGNORE assignment_tags SET tag_id = ? WHERE tag_id = ?;
