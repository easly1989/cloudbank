-- name: GetAppConfig :one
SELECT value FROM app_config WHERE key = ?;

-- name: SetAppConfig :exec
INSERT INTO app_config (key, value) VALUES (?, ?)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- name: UpsertPushSubscription :exec
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES (?, ?, ?, ?)
ON CONFLICT (endpoint) DO UPDATE SET
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;

-- name: DeletePushSubscription :exec
DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?;

-- name: DeletePushSubscriptionByEndpoint :exec
DELETE FROM push_subscriptions WHERE endpoint = ?;

-- name: ListPushSubscriptionsForUser :many
SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?;

-- name: ListPushUserIDs :many
SELECT DISTINCT user_id FROM push_subscriptions;

-- name: InsertReminderIfNew :execrows
INSERT OR IGNORE INTO push_reminders (user_id, ref) VALUES (?, ?);
