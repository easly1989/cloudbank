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

// apiTokenPrefix tags personal API tokens so they are recognizable (in logs,
// secret scanners, the UI) and distinct from session tokens.
const apiTokenPrefix = "cbp_"

// newAPIToken returns a fresh personal API token, its storage id (sha256), and a
// short display prefix. Like a session token, only the id is persisted.
func newAPIToken() (token, id, display string, err error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", "", "", err
	}
	token = apiTokenPrefix + base64.RawURLEncoding.EncodeToString(b)
	// A short, non-secret prefix for the list UI (e.g. "cbp_A1b2c3…").
	display = token[:len(apiTokenPrefix)+6]
	return token, hashToken(token), display, nil
}
