-- name: GetCalendarFeed :one
SELECT id, token FROM calendar_feeds WHERE user_id = ? AND wallet_id = ? LIMIT 1;

-- name: UpsertCalendarFeed :one
-- A new token keeps the row's id, so a regenerated address differs only in it.
INSERT INTO calendar_feeds (user_id, wallet_id, token) VALUES (?, ?, ?)
ON CONFLICT (user_id, wallet_id) DO UPDATE SET token = excluded.token
RETURNING id;

-- name: DeleteCalendarFeed :exec
DELETE FROM calendar_feeds WHERE user_id = ? AND wallet_id = ?;

-- name: ResolveCalendarFeed :one
-- A feed whose user is still an active member of its wallet, with the wallet's
-- title for the calendar's name.
SELECT f.token, f.wallet_id, w.title AS wallet_title
FROM calendar_feeds f
JOIN wallets w ON w.id = f.wallet_id
JOIN wallet_members m ON m.wallet_id = f.wallet_id AND m.user_id = f.user_id
JOIN users u ON u.id = f.user_id AND u.disabled = 0
WHERE f.id = ?
LIMIT 1;
