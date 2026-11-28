-- name: CountPasskeys :one
SELECT COUNT(*) FROM passkeys WHERE user_id = ?;

-- name: ListPasskeys :many
SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at, id;

-- name: GetPasskeyUserHandle :one
SELECT user_handle FROM passkeys WHERE user_id = ? LIMIT 1;

-- name: ListPasskeysByHandle :many
SELECT * FROM passkeys WHERE user_handle = ? AND rp_id = ?;

-- name: CreatePasskey :one
INSERT INTO passkeys (user_id, credential_id, user_handle, rp_id, name, credential, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: UpdatePasskeyUse :exec
UPDATE passkeys SET credential = ?, last_used_at = ? WHERE id = ?;

-- name: RenamePasskey :execrows
UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?;

-- name: DeletePasskey :execrows
DELETE FROM passkeys WHERE id = ? AND user_id = ?;

-- name: DeleteUserPasskeys :execrows
DELETE FROM passkeys WHERE user_id = ?;

-- name: CountPasskeysByUser :many
SELECT user_id, COUNT(*) AS n FROM passkeys GROUP BY user_id;
