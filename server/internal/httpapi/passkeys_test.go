package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
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
	// A passkey is bound to a name; an IP or no origin cannot carry one, nor
	// an origin no browser sends.
	for _, origin := range []string{"https://192.168.1.10", "", "https://cloudbank.test:99999", "https://cloudbank.test:" + strings.Repeat("0", 400)} {
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

func TestPasskeyRoutesRefuse(t *testing.T) {
	c := newOIDCSettingsAPI(t, nil)
	resp := c.do(http.MethodPost, "/api/v1/auth/tokens", map[string]any{"name": "script", "scope": "write"}, true)
	var tok struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&tok)
	resp.Body.Close()
	if tok.Token == "" {
		t.Fatalf("no API token (%d)", resp.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodGet, c.base+"/api/v1/auth/me/passkeys", nil)
	req.Header.Set("Authorization", "Bearer "+tok.Token)
	r2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r2.Body.Close()
	if r2.StatusCode != http.StatusForbidden {
		t.Errorf("list with an API token = %d, want 403", r2.StatusCode)
	}

	// No passkey 999 of this user's.
	resp = c.do(http.MethodDelete, "/api/v1/auth/me/passkeys/999", nil, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("delete someone else's passkey = %d, want 404", resp.StatusCode)
	}

	// Only an admin takes a user's passkeys.
	resp = c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "giulia", "password": "supersecret", "isAdmin": false}, true)
	resp.Body.Close()
	g := c.fork()
	resp = g.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "giulia", "password": "supersecret"}, true)
	resp.Body.Close()
	resp = g.do(http.MethodDelete, "/api/v1/admin/users/1/passkeys", nil, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("a user taking the admin's passkeys = %d, want 403", resp.StatusCode)
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
