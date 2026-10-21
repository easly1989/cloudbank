-- name: GetCSVMapping :one
SELECT * FROM csv_mappings WHERE wallet_id = ? AND header = ?;

-- name: UpsertCSVMapping :one
INSERT INTO csv_mappings (wallet_id, header, mapping, date_format, decimal_char, invert_amount)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (wallet_id, header) DO UPDATE SET
    mapping = excluded.mapping, date_format = excluded.date_format,
    decimal_char = excluded.decimal_char, invert_amount = excluded.invert_amount,
    created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
RETURNING *;

-- name: DeleteCSVMapping :execrows
DELETE FROM csv_mappings WHERE wallet_id = ? AND id = ?;
