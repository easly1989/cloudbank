-- name: ListScheduleBills :many
-- Every schedule in the wallet with the template fields the Bills view needs:
-- amount (signed), the target account and its currency (for base conversion),
-- and the recurrence state used to enumerate occurrences and classify them.
SELECT sch.id, sch.template_id, sch.unit, sch.every_n, sch.next_due,
       sch.weekend_mode, sch.remaining, sch.last_posted, sch.auto_post,
       tpl.name AS template_name, tpl.amount AS template_amount,
       tpl.is_transfer AS template_is_transfer, tpl.account_id AS account_id,
       tpl.category_id AS category_id,
       acc.name AS account_name, acc.currency_id AS currency_id
FROM schedules sch
JOIN templates tpl ON tpl.id = sch.template_id
LEFT JOIN accounts acc ON acc.id = tpl.account_id
WHERE sch.wallet_id = ?
ORDER BY sch.next_due, sch.id;
