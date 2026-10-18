-- name: InsertNotification :exec
INSERT INTO notifications (user_id, kind, title, body, url, wallet_id)
VALUES (?, ?, ?, ?, ?, ?);

-- Newest first; a notification about a wallet the person has left is hidden.
-- name: ListNotifications :many
SELECT n.id, n.kind, n.title, n.body, n.url, n.wallet_id, n.created_at, n.read_at
FROM notifications n
WHERE n.user_id = sqlc.arg(user_id)
  AND (n.wallet_id IS NULL OR EXISTS (
      SELECT 1 FROM wallet_members m WHERE m.wallet_id = n.wallet_id AND m.user_id = n.user_id))
ORDER BY n.id DESC
LIMIT sqlc.arg(lim);

-- name: CountUnreadNotifications :one
SELECT COUNT(*) FROM notifications n
WHERE n.user_id = sqlc.arg(user_id) AND n.read_at IS NULL
  AND (n.wallet_id IS NULL OR EXISTS (
      SELECT 1 FROM wallet_members m WHERE m.wallet_id = n.wallet_id AND m.user_id = n.user_id));

-- name: MarkNotificationRead :execrows
UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ? AND user_id = ? AND read_at IS NULL;

-- name: MarkAllNotificationsRead :exec
UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id = ? AND read_at IS NULL;

-- name: PurgeNotificationsBefore :execrows
DELETE FROM notifications WHERE created_at < ?;

-- name: ListNotificationPrefs :many
SELECT kind, channel, enabled FROM notification_prefs WHERE user_id = ?;

-- name: SetNotificationPref :exec
INSERT INTO notification_prefs (user_id, kind, channel, enabled) VALUES (?, ?, ?, ?)
ON CONFLICT (user_id, kind, channel) DO UPDATE SET enabled = excluded.enabled;

-- name: ListNotificationChannels :many
SELECT * FROM notification_channels WHERE user_id = ?;

-- name: GetNotificationChannel :one
SELECT * FROM notification_channels WHERE user_id = ? AND channel = ?;

-- name: UpsertNotificationChannel :exec
INSERT INTO notification_channels (user_id, channel, target, secret, local_ok)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT (user_id, channel) DO UPDATE SET
    target = excluded.target, secret = excluded.secret, local_ok = excluded.local_ok,
    last_error = '', last_error_at = NULL;

-- name: DeleteNotificationChannel :exec
DELETE FROM notification_channels WHERE user_id = ? AND channel = ?;

-- name: SetNotificationChannelOK :exec
UPDATE notification_channels
SET last_error = '', last_error_at = NULL, last_ok_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id = ? AND channel = ?;

-- name: SetNotificationChannelError :exec
UPDATE notification_channels
SET last_error = ?, last_error_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id = ? AND channel = ?;

-- name: InsertNotificationDelivery :exec
INSERT INTO notification_deliveries (user_id, channel, payload, next_at) VALUES (?, ?, ?, ?);

-- name: ListDueNotificationDeliveries :many
SELECT * FROM notification_deliveries WHERE next_at <= ? ORDER BY next_at, id LIMIT ?;

-- name: RescheduleNotificationDelivery :exec
UPDATE notification_deliveries SET attempts = ?, next_at = ? WHERE id = ?;

-- name: DeleteNotificationDelivery :exec
DELETE FROM notification_deliveries WHERE id = ?;
