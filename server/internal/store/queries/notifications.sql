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

-- name: GetNotificationSettings :one
SELECT * FROM notification_settings WHERE user_id = ?;

-- name: UpsertNotificationSettings :exec
INSERT INTO notification_settings (user_id, amounts_outside, timezone, digest_at, quiet_hours, quiet_from, quiet_to, review_days)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id) DO UPDATE SET
    amounts_outside = excluded.amounts_outside, timezone = excluded.timezone,
    digest_at = excluded.digest_at, quiet_hours = excluded.quiet_hours,
    quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, review_days = excluded.review_days;

-- name: ListDigestKinds :many
SELECT kind FROM notification_digest_kinds WHERE user_id = ? ORDER BY kind;

-- name: SetDigestKind :exec
INSERT INTO notification_digest_kinds (user_id, kind) VALUES (?, ?)
ON CONFLICT (user_id, kind) DO NOTHING;

-- name: UnsetDigestKind :exec
DELETE FROM notification_digest_kinds WHERE user_id = ? AND kind = ?;

-- name: InsertHeldNotification :exec
INSERT INTO notification_held (user_id, channel, payload, digest, held_at) VALUES (?, ?, ?, ?, ?);

-- name: ListHeldUsers :many
SELECT DISTINCT user_id FROM notification_held ORDER BY user_id;

-- name: ListHeldNotifications :many
SELECT * FROM notification_held WHERE user_id = ? ORDER BY id;

-- name: DeleteHeldNotification :exec
DELETE FROM notification_held WHERE id = ?;

-- name: HasReminder :one
SELECT COUNT(*) FROM push_reminders WHERE user_id = ? AND ref = ?;

-- name: ListReviewWaiting :many
SELECT transaction_id, since FROM review_waiting WHERE wallet_id = ? ORDER BY transaction_id;

-- name: InsertReviewWaiting :exec
INSERT INTO review_waiting (transaction_id, wallet_id, since) VALUES (?, ?, ?)
ON CONFLICT (transaction_id) DO NOTHING;

-- name: DeleteReviewWaiting :exec
DELETE FROM review_waiting WHERE transaction_id = ?;

-- name: IsNotificationWalletOff :one
SELECT COUNT(*) FROM notification_wallets_off WHERE user_id = ? AND wallet_id = ?;

-- name: SetNotificationWalletOff :exec
INSERT INTO notification_wallets_off (user_id, wallet_id) VALUES (?, ?)
ON CONFLICT (user_id, wallet_id) DO NOTHING;

-- name: SetNotificationWalletOn :exec
DELETE FROM notification_wallets_off WHERE user_id = ? AND wallet_id = ?;

-- name: ListNotificationThresholds :many
-- One person's thresholds on the accounts of one wallet.
SELECT t.account_id, t.large_over, t.low_under
FROM notification_thresholds t JOIN accounts a ON a.id = t.account_id
WHERE t.user_id = ? AND a.wallet_id = ?
ORDER BY t.account_id;

-- name: SetNotificationThreshold :exec
INSERT INTO notification_thresholds (user_id, account_id, large_over, low_under) VALUES (?, ?, ?, ?)
ON CONFLICT (user_id, account_id) DO UPDATE SET
    large_over = excluded.large_over, low_under = excluded.low_under,
    low_below = CASE WHEN excluded.low_under IS notification_thresholds.low_under THEN notification_thresholds.low_below ELSE 0 END;

-- name: ListLargeThresholds :many
-- Every threshold on large expenses of a person still a member of the
-- account's wallet.
SELECT t.user_id, t.account_id, t.large_over, a.wallet_id
FROM notification_thresholds t
JOIN accounts a ON a.id = t.account_id
JOIN wallet_members m ON m.wallet_id = a.wallet_id AND m.user_id = t.user_id
WHERE t.large_over IS NOT NULL;

-- name: ListLowThresholds :many
-- Every low-balance threshold of a person still a member of the account's
-- wallet, with the account's balance parts.
SELECT t.user_id, t.account_id, t.low_under, t.low_below, a.wallet_id, a.name, a.initial_balance,
    CAST(COALESCE((SELECT SUM(x.amount) FROM transactions x
        WHERE x.account_id = a.id AND x.date <= sqlc.arg(today)), 0) AS INTEGER) AS today_delta
FROM notification_thresholds t
JOIN accounts a ON a.id = t.account_id
JOIN wallet_members m ON m.wallet_id = a.wallet_id AND m.user_id = t.user_id
WHERE t.low_under IS NOT NULL;

-- name: SetLowBelow :exec
UPDATE notification_thresholds SET low_below = ? WHERE user_id = ? AND account_id = ?;

-- name: ListTransactionsSince :many
-- The expenses written after id, oldest first, with who and what wrote them.
SELECT t.id, t.wallet_id, t.account_id, t.date, t.amount, t.memo, t.origin, t.created_by,
    COALESCE(p.name, '') AS payee
FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id
WHERE t.id > ? AND t.amount < 0
ORDER BY t.id
LIMIT 500;

-- name: MaxTransactionID :one
SELECT CAST(COALESCE(MAX(id), 0) AS INTEGER) FROM transactions;
