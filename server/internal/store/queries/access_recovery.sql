-- name: InsertAccessRecoveryCode :exec
INSERT INTO access_recovery_codes (user_id, code_hash) VALUES (?, ?);

-- name: ConsumeAccessRecoveryCode :execrows
UPDATE access_recovery_codes
SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id = ? AND code_hash = ? AND used_at IS NULL;

-- name: DeleteAccessRecoveryCodes :exec
DELETE FROM access_recovery_codes WHERE user_id = ?;

-- name: CountUnusedAccessRecoveryCodes :one
SELECT COUNT(*) FROM access_recovery_codes WHERE user_id = ? AND used_at IS NULL;
