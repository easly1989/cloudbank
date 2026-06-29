-- name: CreateWallet :one
INSERT INTO wallets (title, owner_name)
VALUES (?, ?)
RETURNING *;

-- name: GetWallet :one
SELECT * FROM wallets WHERE id = ? LIMIT 1;

-- name: ListAllWalletIDs :many
SELECT id FROM wallets ORDER BY id;

-- name: ListWalletSettings :many
SELECT id, settings_json FROM wallets;

-- name: ListWalletsForUser :many
SELECT w.*, m.role AS member_role
FROM wallets w
JOIN wallet_members m ON m.wallet_id = w.id
WHERE m.user_id = ?
ORDER BY w.title;

-- name: UpdateWallet :exec
UPDATE wallets SET title = ?, owner_name = ?, settings_json = ? WHERE id = ?;

-- name: DeleteWallet :exec
DELETE FROM wallets WHERE id = ?;

-- name: AddWalletMember :exec
INSERT INTO wallet_members (wallet_id, user_id, role)
VALUES (?, ?, ?);

-- name: GetWalletMembership :one
SELECT role FROM wallet_members WHERE wallet_id = ? AND user_id = ? LIMIT 1;
