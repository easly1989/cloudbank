-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = ? LIMIT 1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = ? LIMIT 1;

-- name: ListUsers :many
SELECT * FROM users ORDER BY username;

-- name: CountUsers :one
SELECT COUNT(*) FROM users;

-- name: CreateUser :one
INSERT INTO users (username, email, password_hash, is_admin, locale, theme)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: SetUserDisabled :exec
UPDATE users SET disabled = ? WHERE id = ?;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = ? WHERE id = ?;

-- name: UpdateUserSettings :exec
UPDATE users SET locale = ?, theme = ?, preferences = ? WHERE id = ?;
