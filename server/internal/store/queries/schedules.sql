-- name: InsertSchedule :one
INSERT INTO schedules (
    wallet_id, template_id, unit, every_n, next_due, weekend_mode,
    remaining, post_advance, auto_post
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetSchedule :one
SELECT * FROM schedules WHERE id = ? LIMIT 1;

-- name: ListSchedulesForWallet :many
SELECT sch.*, tpl.name AS template_name, tpl.amount AS template_amount,
       tpl.is_transfer AS template_is_transfer
FROM schedules sch
JOIN templates tpl ON tpl.id = sch.template_id
WHERE sch.wallet_id = ?
ORDER BY sch.next_due, sch.id;

-- name: ListAllSchedules :many
SELECT * FROM schedules ORDER BY id;

-- name: ListUpcomingSchedules :many
SELECT sch.*, tpl.name AS template_name, tpl.amount AS template_amount,
       tpl.is_transfer AS template_is_transfer
FROM schedules sch
JOIN templates tpl ON tpl.id = sch.template_id
WHERE sch.wallet_id = ? AND sch.next_due <= ?
ORDER BY sch.next_due, sch.id;

-- name: UpdateScheduleConfig :exec
UPDATE schedules SET
    unit = ?, every_n = ?, next_due = ?, weekend_mode = ?,
    remaining = ?, post_advance = ?, auto_post = ?
WHERE id = ?;

-- name: AdvanceSchedule :exec
UPDATE schedules SET next_due = ?, remaining = ?, last_posted = ? WHERE id = ?;

-- name: DeleteSchedule :exec
DELETE FROM schedules WHERE id = ?;

-- name: ListSchedulesForCalendar :many
-- Every schedule of a wallet with what the calendar needs to project its
-- occurrences: the cadence, and the template's name, amount and account.
SELECT sch.id, sch.template_id, sch.unit, sch.every_n, sch.next_due, sch.weekend_mode,
       sch.remaining, sch.auto_post,
       tpl.name AS template_name, tpl.amount AS template_amount,
       tpl.is_transfer AS template_is_transfer, tpl.is_split AS template_is_split,
       tpl.account_id AS account_id
FROM schedules sch
JOIN templates tpl ON tpl.id = sch.template_id
WHERE sch.wallet_id = ?
ORDER BY sch.id;

-- name: ListScheduledTransactionsInRange :many
-- The transactions schedules registered between two dates. A transfer is two
-- rows with the same template; only the leg on the template's own account
-- stands for the occurrence.
SELECT t.id, t.template_id, t.account_id, t.date, t.amount, t.status,
       tpl.name AS template_name, tpl.is_transfer AS template_is_transfer
FROM templates tpl
JOIN transactions t ON t.template_id = tpl.id AND t.wallet_id = tpl.wallet_id
WHERE tpl.wallet_id = sqlc.arg(wallet_id)
  AND t.date >= sqlc.arg(from_date) AND t.date <= sqlc.arg(to_date)
  AND (tpl.is_transfer = 0 OR t.account_id = tpl.account_id)
ORDER BY t.date, t.id;
