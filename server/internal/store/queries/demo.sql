-- Queries for the public demo build only (the `demo` build tag). A demo runs on
-- a disposable database whose every user is a throwaway, so these delete
-- freely; nothing outside internal/demo may call them.

-- name: DemoDeleteWalletsOfIdleUsers :exec
-- A demo user is idle once no session of theirs outlives the cutoff. Their
-- wallets go first: wallets are not tied to users by a cascade.
DELETE FROM wallets WHERE id IN (
    SELECT m.wallet_id FROM wallet_members m
    WHERE NOT EXISTS (
        SELECT 1 FROM sessions s WHERE s.user_id = m.user_id AND s.expires_at > ?
    )
);

-- name: DemoDeleteIdleUsers :execrows
DELETE FROM users WHERE NOT EXISTS (
    SELECT 1 FROM sessions s WHERE s.user_id = users.id AND s.expires_at > ?
);

-- name: DemoCountWalletTransactions :one
SELECT COUNT(*) FROM transactions WHERE wallet_id = ?;

-- name: DemoCountUserWallets :one
SELECT COUNT(*) FROM wallet_members WHERE user_id = ?;

-- name: DemoLinkFills :execrows
-- Ties the seeded fuel payments to the demo's car: the HomeBank file the seed
-- comes from has no vehicles, only the fills' memos (d= the odometer).
UPDATE transactions SET vehicle_id = sqlc.arg(vehicle_id)
WHERE wallet_id = sqlc.arg(wallet_id) AND memo LIKE 'd=%';
