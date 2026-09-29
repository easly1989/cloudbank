package banksync

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/netguard"
)

// A setup token is the user's input: its claim URL must be https, and the
// default client reaches only the public internet (#543).
func TestSimplefinClaimStaysOnThePublicInternet(t *testing.T) {
	hits := 0
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		_, _ = w.Write([]byte("https://user:pass@bridge.example/simplefin"))
	}))
	defer srv.Close()
	token := func(u string) string { return base64.StdEncoding.EncodeToString([]byte(u)) }
	ctx := context.Background()
	c := newSimplefinClient(nil)

	if _, err := c.claim(ctx, token("http://bridge.example/claim/x")); !errors.Is(err, ErrTokenClaimed) {
		t.Errorf("http claim URL: err = %v, want ErrTokenClaimed", err)
	}
	if _, err := c.claim(ctx, token(srv.URL+"/claim/x")); !errors.Is(err, netguard.ErrNotPublic) {
		t.Errorf("loopback claim URL: err = %v, want ErrNotPublic", err)
	}
	if hits != 0 {
		t.Fatalf("the loopback server was reached %d times", hits)
	}
}
