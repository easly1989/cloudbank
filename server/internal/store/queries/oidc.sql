-- name: GetUserIDByOIDCIdentity :one
SELECT user_id FROM user_oidc_identities WHERE issuer = ? AND subject = ? LIMIT 1;

-- name: LinkOIDCIdentity :exec
INSERT INTO user_oidc_identities (user_id, issuer, subject)
VALUES (?, ?, ?)
ON CONFLICT (issuer, subject) DO NOTHING;

-- name: CountOIDCIdentitiesForUser :one
SELECT COUNT(*) FROM user_oidc_identities WHERE user_id = ?;

-- name: CountOIDCIdentitiesForIssuer :one
SELECT COUNT(*) FROM user_oidc_identities WHERE issuer = ?;

-- name: DeleteOIDCIdentitiesForIssuer :exec
DELETE FROM user_oidc_identities WHERE issuer = ?;

-- name: GetOIDCSettings :one
SELECT issuer, client_id, client_secret, redirect_url, scopes, name, auto_provision, admin_email
FROM oidc_settings WHERE id = 1;

-- name: UpsertOIDCSettings :exec
INSERT INTO oidc_settings (id, issuer, client_id, client_secret, redirect_url, scopes, name, auto_provision, admin_email)
VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  issuer = excluded.issuer, client_id = excluded.client_id, client_secret = excluded.client_secret,
  redirect_url = excluded.redirect_url, scopes = excluded.scopes, name = excluded.name,
  auto_provision = excluded.auto_provision, admin_email = excluded.admin_email,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- name: DeleteOIDCSettings :exec
DELETE FROM oidc_settings WHERE id = 1;
