-- name: InsertCategory :one
INSERT INTO categories (wallet_id, parent_id, name, is_income, no_budget)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: GetCategory :one
SELECT * FROM categories WHERE id = ? LIMIT 1;

-- name: ListCategoriesForWallet :many
SELECT * FROM categories WHERE wallet_id = ? ORDER BY name;

-- name: UpdateCategory :exec
UPDATE categories SET name = ?, is_income = ?, no_budget = ? WHERE id = ?;

-- name: SetChildrenIncome :exec
UPDATE categories SET is_income = ? WHERE parent_id = ?;

-- name: DeleteCategory :exec
DELETE FROM categories WHERE id = ?;

-- name: CountSubcategories :one
SELECT COUNT(*) FROM categories WHERE parent_id = ?;

-- name: ReparentChildren :exec
UPDATE categories SET parent_id = ? WHERE parent_id = ?;

-- name: CountPayeesWithCategory :one
SELECT COUNT(*) FROM payees WHERE default_category_id = ?;

-- name: ReassignPayeeCategory :exec
UPDATE payees SET default_category_id = ? WHERE default_category_id = ?;
