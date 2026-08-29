-- name: SetUserTOTP :exec
UPDATE users SET totp_secret = ?, totp_enabled = ? WHERE id = ?;

-- name: ClearUserTOTP :exec
UPDATE users SET totp_secret = '', totp_enabled = 0 WHERE id = ?;

-- name: InsertRecoveryCode :exec
INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?);

-- name: ConsumeRecoveryCode :execrows
UPDATE mfa_recovery_codes
SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id = ? AND code_hash = ? AND used_at IS NULL;

-- name: DeleteRecoveryCodes :exec
DELETE FROM mfa_recovery_codes WHERE user_id = ?;

-- name: CountUnusedRecoveryCodes :one
SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL;
