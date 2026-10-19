-- name: CreateSession :exec
INSERT INTO sessions (id, user_id, expires_at, user_agent)
VALUES (?, ?, ?, ?);

-- name: GetSession :one
SELECT * FROM sessions WHERE id = ? LIMIT 1;

-- name: TouchSession :exec
UPDATE sessions
SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), expires_at = ?
WHERE id = ?;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE id = ?;

-- name: DeleteUserSessions :exec
DELETE FROM sessions WHERE user_id = ?;

-- name: DeleteExpiredSessions :exec
DELETE FROM sessions WHERE expires_at < ?;

-- name: DeleteOtherUserSessions :exec
DELETE FROM sessions WHERE user_id = ? AND id <> ?;

-- name: RememberDevice :execrows
INSERT INTO known_devices (user_id, device) VALUES (?, ?)
ON CONFLICT (user_id, device) DO NOTHING;

-- name: CountKnownDevices :one
SELECT COUNT(*) FROM known_devices WHERE user_id = ?;
