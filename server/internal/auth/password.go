// Package auth provides password hashing, opaque session tokens, a login rate
// limiter, and the authentication service that ties them to the user/session
// storage.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"runtime"
	"strings"

	"golang.org/x/crypto/argon2"
)

// argon2id parameters. These follow current OWASP guidance and are encoded in
// every hash so they can be tuned later without breaking existing passwords.
type argon2Params struct {
	memoryKiB   uint32
	iterations  uint32
	parallelism uint8
	saltLen     uint32
	keyLen      uint32
}

func defaultParams() argon2Params {
	p := uint8(runtime.NumCPU())
	if p < 1 {
		p = 1
	}
	if p > 4 {
		p = 4
	}
	return argon2Params{
		memoryKiB:   64 * 1024, // 64 MiB
		iterations:  3,
		parallelism: p,
		saltLen:     16,
		keyLen:      32,
	}
}

// ErrInvalidHash is returned when a stored hash cannot be parsed.
var ErrInvalidHash = errors.New("auth: invalid password hash")

// Hash derives a PHC-formatted argon2id hash of the password.
func Hash(password string) (string, error) {
	p := defaultParams()
	salt := make([]byte, p.saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, p.iterations, p.memoryKiB, p.parallelism, p.keyLen)

	b64 := base64.RawStdEncoding
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.memoryKiB, p.iterations, p.parallelism,
		b64.EncodeToString(salt), b64.EncodeToString(key),
	), nil
}

// Verify reports whether password matches the given PHC-formatted argon2id hash.
// The comparison is constant-time.
func Verify(encoded, password string) (bool, error) {
	p, salt, key, err := decodeHash(encoded)
	if err != nil {
		return false, err
	}
	computed := argon2.IDKey([]byte(password), salt, p.iterations, p.memoryKiB, p.parallelism, p.keyLen)
	if subtle.ConstantTimeEq(int32(len(computed)), int32(len(key))) == 0 {
		return false, nil
	}
	return subtle.ConstantTimeCompare(computed, key) == 1, nil
}

func decodeHash(encoded string) (argon2Params, []byte, []byte, error) {
	parts := strings.Split(encoded, "$")
	// "" / argon2id / v=19 / m=..,t=..,p=.. / salt / hash
	if len(parts) != 6 || parts[1] != "argon2id" {
		return argon2Params{}, nil, nil, ErrInvalidHash
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return argon2Params{}, nil, nil, ErrInvalidHash
	}
	if version != argon2.Version {
		return argon2Params{}, nil, nil, ErrInvalidHash
	}

	var p argon2Params
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memoryKiB, &p.iterations, &p.parallelism); err != nil {
		return argon2Params{}, nil, nil, ErrInvalidHash
	}

	b64 := base64.RawStdEncoding
	salt, err := b64.DecodeString(parts[4])
	if err != nil {
		return argon2Params{}, nil, nil, ErrInvalidHash
	}
	key, err := b64.DecodeString(parts[5])
	if err != nil {
		return argon2Params{}, nil, nil, ErrInvalidHash
	}
	p.saltLen = uint32(len(salt))
	p.keyLen = uint32(len(key))
	return p, salt, key, nil
}
