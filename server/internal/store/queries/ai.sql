-- name: GetAISettings :one
SELECT enabled, base_url, model, api_key FROM ai_settings WHERE user_id = ?;

-- name: UpsertAISettings :exec
INSERT INTO ai_settings (user_id, enabled, base_url, model, api_key, updated_at)
VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (user_id) DO UPDATE SET
    enabled = excluded.enabled, base_url = excluded.base_url,
    model = excluded.model, api_key = excluded.api_key, updated_at = excluded.updated_at;
