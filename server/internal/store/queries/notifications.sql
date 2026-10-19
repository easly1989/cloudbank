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
INSERT INTO notification_channels (
    user_id, channel, target, secret, server, options, local_ok,
    verified, code_hash, code_link, code_expires_at, code_attempts)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, channel) DO UPDATE SET
    target = excluded.target, secret = excluded.secret, server = excluded.server,
    options = excluded.options, local_ok = excluded.local_ok,
    verified = excluded.verified, code_hash = excluded.code_hash, code_link = excluded.code_link,
    code_expires_at = excluded.code_expires_at, code_attempts = excluded.code_attempts,
    last_error = '', last_error_at = NULL;

-- name: SetNotificationChannelCode :exec
UPDATE notification_channels
SET code_hash = ?, code_link = ?, code_expires_at = ?, code_attempts = 0
WHERE user_id = ? AND channel = ? AND verified = 0;

-- name: CountNotificationCodeAttempt :execrows
UPDATE notification_channels SET code_attempts = code_attempts + 1
WHERE user_id = ? AND channel = ? AND verified = 0 AND code_attempts < ?;

-- The code was right: the channel sends from now on. A Telegram chat linked
-- through the shared bot gets its target here.
-- name: VerifyNotificationChannel :exec
UPDATE notification_channels
SET verified = 1, code_hash = '', code_link = '', code_expires_at = NULL, code_attempts = 0,
    target = COALESCE(sqlc.narg(target), target)
WHERE user_id = sqlc.arg(user_id) AND channel = sqlc.arg(channel) AND verified = 0;

-- name: FindNotificationCode :one
SELECT user_id, code_expires_at FROM notification_channels
WHERE channel = ? AND code_hash = ? AND verified = 0;

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

-- Who a wallet event is for: the wallet's members whose account is on.
-- name: ListWalletRecipients :many
SELECT u.id, u.locale FROM wallet_members m JOIN users u ON u.id = m.user_id
WHERE m.wallet_id = ? AND u.disabled = 0
ORDER BY u.id;

-- Who an admin event is for: the administrators whose account is on.
-- name: ListAdminRecipients :many
SELECT id, locale FROM users WHERE is_admin = 1 AND disabled = 0 ORDER BY id;
