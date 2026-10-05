-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = ? LIMIT 1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = ? LIMIT 1;

-- name: CountUsersByEmail :one
SELECT COUNT(*) FROM users WHERE email = ?;

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

-- name: UpdateUserSettings :execrows
-- Every save moves the revision on. With a revision given, the save only lands
-- when the stored one still matches: no row changed means someone saved first.
UPDATE users
SET locale = sqlc.arg(locale), theme = sqlc.arg(theme), preferences = sqlc.arg(preferences),
    preferences_rev = preferences_rev + 1
WHERE id = sqlc.arg(id)
  AND (CAST(sqlc.narg(rev) AS INTEGER) IS NULL OR preferences_rev = CAST(sqlc.narg(rev) AS INTEGER));
