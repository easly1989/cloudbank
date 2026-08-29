-- name: InsertAPIToken :one
INSERT INTO api_tokens (id, user_id, name, scope, prefix, expires_at)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetAPIToken :one
SELECT * FROM api_tokens WHERE id = ? LIMIT 1;

-- name: ListAPITokensForUser :many
SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id;

-- name: TouchAPIToken :exec
UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?;

-- name: DeleteAPIToken :execrows
DELETE FROM api_tokens WHERE id = ? AND user_id = ?;
