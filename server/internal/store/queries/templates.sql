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

-- name: LinkTemplateTransactions :execrows
-- Ties to a template the transactions it stands for that were written without
-- the link: same account, payee and category. The demo's seeded year comes
-- from a HomeBank file, which does not record which schedule posted what.
UPDATE transactions SET template_id = sqlc.arg(template_id)
WHERE template_id IS NULL
  AND wallet_id = (SELECT tpl.wallet_id FROM templates tpl WHERE tpl.id = sqlc.arg(template_id))
  AND account_id = (SELECT tpl.account_id FROM templates tpl WHERE tpl.id = sqlc.arg(template_id))
  AND payee_id = (SELECT tpl.payee_id FROM templates tpl WHERE tpl.id = sqlc.arg(template_id))
  AND category_id = (SELECT tpl.category_id FROM templates tpl WHERE tpl.id = sqlc.arg(template_id));

-- name: TemplateUsage :many
-- How often each template was used: the transactions made from it dated in
-- [from_date, to_date], and the latest on or before to_date (#560). A transfer
-- counts once, by its leg on the template's own account.
SELECT t.template_id AS template_id,
       CAST(SUM(CASE WHEN t.date >= sqlc.arg(from_date) THEN 1 ELSE 0 END) AS INTEGER) AS txn_count,
       CAST(MAX(t.date) AS TEXT) AS last_date
FROM transactions t
JOIN templates tpl ON tpl.id = t.template_id
WHERE t.wallet_id = sqlc.arg(wallet_id)
  AND t.date <= sqlc.arg(to_date)
  AND (tpl.account_id IS NULL OR t.account_id = tpl.account_id)
GROUP BY t.template_id;

-- name: CountTemplateSchedules :one
SELECT COUNT(*) FROM schedules WHERE template_id = ?;
