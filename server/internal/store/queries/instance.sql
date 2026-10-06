-- name: GetInstanceSetting :one
SELECT value FROM instance_settings WHERE key = ?;

-- name: SetInstanceSetting :exec
INSERT INTO instance_settings (key, value) VALUES (?, ?)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
