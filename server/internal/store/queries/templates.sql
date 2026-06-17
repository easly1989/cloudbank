-- name: InsertTemplate :one
INSERT INTO templates (
    wallet_id, name, account_id, amount, payment_mode, status, info,
    payee_id, category_id, memo, tags, is_split, is_transfer, to_account_id
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetTemplate :one
SELECT * FROM templates WHERE id = ? LIMIT 1;

-- name: ListTemplatesForWallet :many
SELECT * FROM templates WHERE wallet_id = ? ORDER BY name COLLATE NOCASE;

-- name: UpdateTemplate :exec
UPDATE templates SET
    name = ?, account_id = ?, amount = ?, payment_mode = ?, status = ?, info = ?,
    payee_id = ?, category_id = ?, memo = ?, tags = ?, is_split = ?,
    is_transfer = ?, to_account_id = ?
WHERE id = ?;

-- name: DeleteTemplate :exec
DELETE FROM templates WHERE id = ?;

-- name: InsertTemplateSplit :exec
INSERT INTO template_splits (template_id, category_id, amount, memo, position)
VALUES (?, ?, ?, ?, ?);

-- name: ListTemplateSplits :many
SELECT * FROM template_splits WHERE template_id = ? ORDER BY position, id;

-- name: DeleteTemplateSplits :exec
DELETE FROM template_splits WHERE template_id = ?;
