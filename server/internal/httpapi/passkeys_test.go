package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/oidc"
)

func passkeysOffered(t *testing.T, c *testClient) bool {
	t.Helper()
	resp := c.do(http.MethodGet, "/api/v1/auth/config", nil, false)
	defer resp.Body.Close()
	var cfg struct {
		Passkeys bool `json:"passkeys"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&cfg)
	return cfg.Passkeys
}

// passkeyBegin asks for a sign-in challenge as a browser on origin would.
func passkeyBegin(t *testing.T, c *testClient, origin string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, c.base+"/api/v1/auth/passkeys/login/begin", nil)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestPasskeyRoutes(t *testing.T) {
	c := newOIDCSettingsAPI(t, nil)
	if !passkeysOffered(t, c) {
		t.Fatal("/auth/config does not offer passkeys on a password-login server")
	}
	if got := passkeyBegin(t, c, "https://cloudbank.test"); got != http.StatusOK {
		t.Fatalf("begin by name = %d", got)
	}
	// A passkey is bound to a name; an IP or no origin cannot carry one.
	for _, origin := range []string{"https://192.168.1.10", ""} {
		if got := passkeyBegin(t, c, origin); got != http.StatusBadRequest {
			t.Errorf("begin from %q = %d, want 400", origin, got)
		}
	}
	resp := c.do(http.MethodGet, "/api/v1/auth/me/passkeys", nil, false)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list = %d", resp.StatusCode)
	}
}

func TestPasskeysOffWithSSOOnly(t *testing.T) {
	c := newOIDCSettingsAPI(t, func(o *Options, _ *oidc.Store) { o.SSOOnly = true })
	if passkeysOffered(t, c) {
		t.Fatal("/auth/config offers passkeys on an SSO-only server")
	}
	if got := passkeyBegin(t, c, "https://cloudbank.test"); got != http.StatusNotFound && got != http.StatusMethodNotAllowed {
		t.Fatalf("begin on an SSO-only server = %d", got)
	}
}
