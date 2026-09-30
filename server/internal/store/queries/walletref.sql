-- Ownership checks for the ids a request names (#543): each counts how many of
-- the given ids are rows of the wallet.

-- name: CountAccountsInWallet :one
SELECT COUNT(*) FROM accounts WHERE wallet_id = sqlc.arg(wallet_id) AND id IN (sqlc.slice(ids));

-- name: CountCategoriesInWallet :one
SELECT COUNT(*) FROM categories WHERE wallet_id = sqlc.arg(wallet_id) AND id IN (sqlc.slice(ids));

-- name: CountPayeesInWallet :one
SELECT COUNT(*) FROM payees WHERE wallet_id = sqlc.arg(wallet_id) AND id IN (sqlc.slice(ids));

-- name: CountVehiclesInWallet :one
SELECT COUNT(*) FROM vehicles WHERE wallet_id = sqlc.arg(wallet_id) AND id IN (sqlc.slice(ids));

-- name: CountTemplatesInWallet :one
SELECT COUNT(*) FROM templates WHERE wallet_id = sqlc.arg(wallet_id) AND id IN (sqlc.slice(ids));
