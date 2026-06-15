package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

// tokenBytes is the entropy of a session token (256 bits).
const tokenBytes = 32

// newToken returns a fresh opaque session token and its storage id. The token
// is handed to the client (in a cookie); only the id — sha256(token) — is
// persisted, so a database leak does not expose usable session tokens.
func newToken() (token, id string, err error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, hashToken(token), nil
}

// hashToken returns the storage id for a token.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
