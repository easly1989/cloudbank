package auth

import (
	"testing"
	"time"
)

// TestTOTPRFC6238Vectors checks totpCode against the RFC 6238 Appendix B test
// vectors (SHA-1 seed "12345678901234567890"), taking the trailing 6 digits of
// the published 8-digit values.
func TestTOTPRFC6238Vectors(t *testing.T) {
	secret := base32NoPad.EncodeToString([]byte("12345678901234567890"))
	cases := []struct {
		unix int64
		want string // last 6 of the RFC's 8-digit value
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1111111111, "050471"},
		{1234567890, "005924"},
		{2000000000, "279037"},
	}
	for _, c := range cases {
		got, err := totpCode(secret, time.Unix(c.unix, 0).UTC())
		if err != nil {
			t.Fatalf("totpCode(%d): %v", c.unix, err)
		}
		if got != c.want {
			t.Fatalf("totpCode at %d = %s, want %s", c.unix, got, c.want)
		}
	}
}

func TestVerifyTOTPWindow(t *testing.T) {
	secret, _ := generateTOTPSecret()
	now := time.Unix(1_700_000_000, 0).UTC()
	code, _ := totpCode(secret, now)
	if !verifyTOTP(secret, code, now) {
		t.Fatal("current code should verify")
	}
	// The previous window's code is still accepted (clock skew tolerance).
	prev, _ := totpCode(secret, now.Add(-totpStep))
	if !verifyTOTP(secret, prev, now) {
		t.Fatal("previous-window code should verify")
	}
	// Two windows away is rejected.
	old, _ := totpCode(secret, now.Add(-2*totpStep))
	if old != code && verifyTOTP(secret, old, now) {
		t.Fatal("two-window-old code should not verify")
	}
	if verifyTOTP(secret, "000000", now.Add(9*time.Hour)) {
		t.Fatal("unrelated code should not verify")
	}
}
