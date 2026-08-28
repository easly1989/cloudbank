-- name: InsertGoal :one
INSERT INTO goals (wallet_id, name, target_amount, target_date, account_id, note, position)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetGoal :one
SELECT * FROM goals WHERE id = ? LIMIT 1;

-- name: ListGoalsForWallet :many
SELECT
    g.*,
    CAST(COALESCE((SELECT SUM(amount) FROM goal_contributions c WHERE c.goal_id = g.id), 0) AS INTEGER) AS saved
FROM goals g
WHERE g.wallet_id = ?
ORDER BY g.position, g.name;

-- name: GoalSaved :one
SELECT CAST(COALESCE(SUM(amount), 0) AS INTEGER) FROM goal_contributions WHERE goal_id = ?;

-- name: UpdateGoal :exec
UPDATE goals
SET name = ?, target_amount = ?, target_date = ?, account_id = ?, note = ?, position = ?
WHERE id = ?;

-- name: DeleteGoal :exec
DELETE FROM goals WHERE id = ?;

-- name: InsertContribution :one
INSERT INTO goal_contributions (goal_id, date, amount, note)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: ListContributionsForGoal :many
SELECT * FROM goal_contributions WHERE goal_id = ? ORDER BY date DESC, id DESC;

-- name: GetContribution :one
SELECT * FROM goal_contributions WHERE id = ? LIMIT 1;

-- name: DeleteContribution :exec
DELETE FROM goal_contributions WHERE id = ?;
