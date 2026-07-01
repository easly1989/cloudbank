-- name: InsertVehicle :one
INSERT INTO vehicles (wallet_id, name, plate, notes) VALUES (?, ?, ?, ?) RETURNING *;

-- name: GetVehicle :one
SELECT * FROM vehicles WHERE id = ? LIMIT 1;

-- name: ListVehiclesForWallet :many
SELECT * FROM vehicles WHERE wallet_id = ? ORDER BY name;

-- name: UpdateVehicle :exec
UPDATE vehicles SET name = ?, plate = ?, notes = ? WHERE id = ?;

-- name: DeleteVehicle :exec
DELETE FROM vehicles WHERE id = ?;
