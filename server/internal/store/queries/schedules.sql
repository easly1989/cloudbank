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
