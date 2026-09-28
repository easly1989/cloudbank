-- name: GetUserIDByOIDCIdentity :one
SELECT user_id FROM user_oidc_identities WHERE issuer = ? AND subject = ? LIMIT 1;

-- name: LinkOIDCIdentity :exec
INSERT INTO user_oidc_identities (user_id, issuer, subject)
VALUES (?, ?, ?)
ON CONFLICT (issuer, subject) DO NOTHING;

-- name: CountOIDCIdentitiesForUser :one
SELECT COUNT(*) FROM user_oidc_identities WHERE user_id = ?;
