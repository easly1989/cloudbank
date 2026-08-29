package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// TOTP parameters (RFC 6238): 6-digit codes on a 30-second step, HMAC-SHA1. A
// verification also accepts the adjacent windows to tolerate clock skew.
const (
	totpDigits = 6
	totpStep   = 30 * time.Second
	totpIssuer = "CloudBank"
)

var base32NoPad = base32.StdEncoding.WithPadding(base32.NoPadding)

// generateTOTPSecret returns a fresh base32-encoded shared secret (160 bits, the
// RFC-recommended size for SHA-1).
func generateTOTPSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base32NoPad.EncodeToString(b), nil
}

// totpCode computes the RFC 6238 code for a secret at time t.
func totpCode(secret string, t time.Time) (string, error) {
	key, err := base32NoPad.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}
	counter := uint64(t.Unix()) / uint64(totpStep.Seconds())
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	// Dynamic truncation (RFC 4226 §5.3).
	offset := sum[len(sum)-1] & 0x0f
	bin := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])
	mod := uint32(1)
	for i := 0; i < totpDigits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", totpDigits, bin%mod), nil
}

// verifyTOTP reports whether code is valid for the secret at time t, checking
// the current and adjacent 30-second windows. The comparison is constant-time.
func verifyTOTP(secret, code string, t time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	for _, delta := range []time.Duration{0, -totpStep, totpStep} {
		want, err := totpCode(secret, t.Add(delta))
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// normalizeRecoveryCode canonicalizes a user-entered recovery code (uppercase,
// no separators) so it hashes consistently.
func normalizeRecoveryCode(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	code = strings.ReplaceAll(code, "-", "")
	return strings.ReplaceAll(code, " ", "")
}

// newRecoveryCode returns a fresh recovery code: a readable dash-grouped form to
// show the user, and its canonical (ungrouped) form to hash for storage.
func newRecoveryCode() (display, canonical string, err error) {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	canonical = base32NoPad.EncodeToString(b) // 16 chars
	var sb strings.Builder
	for i := 0; i < len(canonical); i += 4 {
		if i > 0 {
			sb.WriteByte('-')
		}
		sb.WriteString(canonical[i : i+4])
	}
	return sb.String(), canonical, nil
}

// otpauthURI builds the provisioning URI an authenticator app scans.
func otpauthURI(account, secret string) string {
	label := url.PathEscape(totpIssuer + ":" + account)
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", totpIssuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprintf("%d", totpDigits))
	q.Set("period", fmt.Sprintf("%d", int(totpStep.Seconds())))
	return "otpauth://totp/" + label + "?" + q.Encode()
}
