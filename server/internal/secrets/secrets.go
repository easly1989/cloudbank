// Package secrets encrypts reversible secrets at rest with AES-256-GCM. The key
// comes from CB_SECRET_KEY (wired via Configure at startup). When no key is set
// the package is a pass-through, so storage stays plaintext and existing rows
// keep working; enabling a key later encrypts each secret on its next write while
// still reading legacy plaintext values.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strings"
)

// prefix marks an encrypted value so it is distinguishable from legacy plaintext.
const prefix = "enc.v1:"

// Cipher seals and opens secret strings. A nil *Cipher is a valid pass-through.
type Cipher struct {
	aead cipher.AEAD
}

// New builds a Cipher from any non-empty passphrase (hashed to a 256-bit key). An
// empty key returns a nil Cipher (pass-through), not an error.
func New(key string) (*Cipher, error) {
	if strings.TrimSpace(key) == "" {
		return nil, nil
	}
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

// Enabled reports whether a key is configured.
func (c *Cipher) Enabled() bool { return c != nil && c.aead != nil }

// Seal returns an encrypted, prefixed representation of s. With no key (or an
// empty string) it returns s unchanged.
func (c *Cipher) Seal(s string) string {
	if !c.Enabled() || s == "" {
		return s
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return s // extremely unlikely; keep the data rather than lose it
	}
	sealed := c.aead.Seal(nonce, nonce, []byte(s), nil) // nonce || ciphertext
	return prefix + base64.StdEncoding.EncodeToString(sealed)
}

// Open reverses Seal. A value without the prefix (legacy plaintext) is returned
// unchanged; an encrypted value that cannot be opened (no or wrong key) is also
// returned unchanged.
func (c *Cipher) Open(s string) string {
	if !strings.HasPrefix(s, prefix) || !c.Enabled() {
		return s
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, prefix))
	if err != nil {
		return s
	}
	ns := c.aead.NonceSize()
	if len(raw) < ns {
		return s
	}
	pt, err := c.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return s
	}
	return string(pt)
}

// def is the process-wide cipher used by the package-level Seal/Open.
var def *Cipher

// Configure sets the process-wide cipher (call once at startup).
func Configure(c *Cipher) { def = c }

// Enabled reports whether the process-wide cipher has a key.
func Enabled() bool { return def.Enabled() }

// Seal encrypts s with the process-wide cipher.
func Seal(s string) string { return def.Seal(s) }

// Open decrypts s with the process-wide cipher.
func Open(s string) string { return def.Open(s) }
