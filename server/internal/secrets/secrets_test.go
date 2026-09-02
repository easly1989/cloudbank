package secrets

import (
	"strings"
	"testing"
)

func TestSealOpenRoundTrip(t *testing.T) {
	c, err := New("hunter2")
	if err != nil || !c.Enabled() {
		t.Fatalf("New: %v enabled=%v", err, c.Enabled())
	}
	sealed := c.Seal("s3cr3t")
	if sealed == "s3cr3t" || !strings.HasPrefix(sealed, prefix) {
		t.Fatalf("value not sealed: %q", sealed)
	}
	if got := c.Open(sealed); got != "s3cr3t" {
		t.Fatalf("Open round-trip = %q, want s3cr3t", got)
	}
	// An empty string is left as-is.
	if c.Seal("") != "" {
		t.Fatal("empty string should not be sealed")
	}
	// Legacy plaintext passes through Open unchanged.
	if c.Open("legacy-plaintext") != "legacy-plaintext" {
		t.Fatal("legacy plaintext should pass through Open")
	}
	// A different key cannot open the value (returns the stored ciphertext).
	other, _ := New("different-key")
	if other.Open(sealed) != sealed {
		t.Fatal("a wrong key must not decrypt the value")
	}
}

func TestPassthroughWhenNoKey(t *testing.T) {
	c, err := New("   ")
	if err != nil {
		t.Fatalf("New(blank): %v", err)
	}
	if c.Enabled() {
		t.Fatal("a blank key should yield a disabled (pass-through) cipher")
	}
	if c.Seal("x") != "x" || c.Open("x") != "x" {
		t.Fatal("disabled cipher must pass through")
	}
	// A nil cipher is safe and passes through.
	var nilC *Cipher
	if nilC.Enabled() || nilC.Seal("x") != "x" || nilC.Open("x") != "x" {
		t.Fatal("nil cipher must be a safe pass-through")
	}
}

func TestNonceRandomized(t *testing.T) {
	c, _ := New("k")
	a := c.Seal("same")
	b := c.Seal("same")
	if a == b {
		t.Fatal("two seals of the same value must differ (randomized nonce)")
	}
	if c.Open(a) != "same" || c.Open(b) != "same" {
		t.Fatal("both ciphertexts must open to the same plaintext")
	}
}

func TestPackageLevelDefault(t *testing.T) {
	t.Cleanup(func() { Configure(nil) })
	Configure(nil)
	if Enabled() || Seal("x") != "x" || Open("x") != "x" {
		t.Fatal("unconfigured default must pass through")
	}
	c, _ := New("key")
	Configure(c)
	if !Enabled() {
		t.Fatal("configured default should be enabled")
	}
	sealed := Seal("v")
	if sealed == "v" || Open(sealed) != "v" {
		t.Fatalf("package-level round-trip failed: %q", sealed)
	}
}
