package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/oidc"
	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

const testCallback = "http://cloudbank.test/api/v1/auth/oidc/callback"

// newOIDCSettingsAPI is a password-login server with the SSO settings mounted,
// set up with an administrator who is signed in. tune changes the options
// before the server starts.
func newOIDCSettingsAPI(t *testing.T, tune func(*Options, *oidc.Store)) *testClient {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	opts := Options{Auth: auth.NewService(db.New(st.Write())), OIDCSettings: oidc.NewStore(st.Write())}
	if tune != nil {
		tune(&opts, opts.OIDCSettings)
	}
	srv := httptest.NewServer(New(opts))
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	c := &testClient{t: t, base: srv.URL, hc: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}, st: st}
	if !opts.SSOOnly {
		resp := c.do(http.MethodPost, "/api/v1/setup", map[string]any{"username": "admin", "password": "supersecret"}, true)
		resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("setup = %d", resp.StatusCode)
		}
	}
	return c
}

func withSecretKey(t *testing.T) {
	t.Helper()
	k, err := secrets.New("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	secrets.Configure(k)
	t.Cleanup(func() { secrets.Configure(nil) })
}

type ssoView struct {
	Source      string `json:"source"`
	Enabled     bool   `json:"enabled"`
	Reachable   bool   `json:"reachable"`
	SecretKey   bool   `json:"secretKey"`
	LinkedUsers int64  `json:"linkedUsers"`
	Issuer      string `json:"issuer"`
	ClientID    string `json:"clientId"`
	HasSecret   bool   `json:"hasSecret"`
	Name        string `json:"name"`
}

// readSSO returns the decoded body and the raw one, to look for the secret in.
func readSSO(t *testing.T, resp *http.Response) (ssoView, string) {
	t.Helper()
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var v ssoView
	_ = json.Unmarshal(raw, &v)
	return v, string(raw)
}

func ssoEnabled(t *testing.T, c *testClient) (bool, string) {
	t.Helper()
	resp := c.do(http.MethodGet, "/api/v1/auth/config", nil, false)
	defer resp.Body.Close()
	var cfg struct {
		OIDC struct {
			Enabled bool   `json:"enabled"`
			Name    string `json:"name"`
		} `json:"oidc"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&cfg)
	return cfg.OIDC.Enabled, cfg.OIDC.Name
}

func ssoInput(issuer, secret string) map[string]any {
	return map[string]any{
		"issuer": issuer, "clientId": "cloudbank", "clientSecret": secret,
		"redirectUrl": testCallback, "name": "Authelia", "autoProvision": true,
	}
}

func TestOIDCSettingsEnvWins(t *testing.T) {
	withSecretKey(t)
	c := newOIDCSettingsAPI(t, func(o *Options, s *oidc.Store) {
		// A provider saved earlier is there, and the variables still win.
		if err := s.Save(context.Background(), oidc.Settings{Config: oidc.Config{Issuer: "https://saved.example", ClientID: "x", ClientSecret: "saved-secret"}}); err != nil {
			t.Fatal(err)
		}
		o.OIDCEnv = &oidc.Settings{Config: oidc.Config{
			Issuer: "https://env.example", ClientID: "env-client", ClientSecret: "env-secret-value",
			RedirectURL: testCallback, Name: "Env",
		}}
	})
	v, raw := readSSO(t, c.do(http.MethodGet, "/api/v1/admin/oidc", nil, false))
	if v.Source != "env" || v.Issuer != "https://env.example" || v.ClientID != "env-client" || !v.HasSecret {
		t.Fatalf("view = %+v", v)
	}
	if strings.Contains(raw, "env-secret-value") || strings.Contains(raw, "saved-secret") {
		t.Fatalf("a secret is in the answer: %s", raw)
	}
	for _, m := range []string{http.MethodPut, http.MethodDelete} {
		if code := errorCode(t, c.do(m, "/api/v1/admin/oidc", ssoInput("https://other.example", "s"), true)); code != "set_by_env" {
			t.Errorf("%s = %q, want set_by_env", m, code)
		}
	}
}

func TestOIDCSettingsFailedDiscoverySavesNothing(t *testing.T) {
	withSecretKey(t)
	idp := newFakeIDP(t)
	idp.setDown(true)
	c := newOIDCSettingsAPI(t, nil)
	resp := c.do(http.MethodPut, "/api/v1/admin/oidc", ssoInput(idp.srv.URL, "very-secret"), true)
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(string(raw), "provider_unreachable") || strings.Contains(string(raw), "down") {
		t.Fatalf("save with the provider down = %d %s", resp.StatusCode, raw)
	}
	if v, _ := readSSO(t, c.do(http.MethodGet, "/api/v1/admin/oidc", nil, false)); v.Source != "none" || v.Enabled {
		t.Fatalf("after a failed save = %+v", v)
	}
	if on, _ := ssoEnabled(t, c); on {
		t.Fatal("SSO is on after a failed save")
	}
}

// A save swaps the provider in at once, the secret stays on the server, and
// moving to another issuer drops the links of the previous one.
func TestOIDCSettingsSaveTakesEffectAndKeepsTheSecret(t *testing.T) {
	withSecretKey(t)
	idp := newFakeIDP(t)
	c := newOIDCSettingsAPI(t, nil)

	v, raw := readSSO(t, c.do(http.MethodPut, "/api/v1/admin/oidc", ssoInput(idp.srv.URL, "very-secret"), true))
	if v.Source != "settings" || !v.Enabled || !v.Reachable || !v.HasSecret || strings.Contains(raw, "very-secret") {
		t.Fatalf("save = %s", raw)
	}
	if on, name := ssoEnabled(t, c); !on || name != "Authelia" {
		t.Fatalf("auth config after save = %v %q", on, name)
	}
	var sealed string
	if err := c.st.Read().QueryRow("SELECT client_secret FROM oidc_settings").Scan(&sealed); err != nil || !secrets.Sealed(sealed) {
		t.Fatalf("stored secret %q is not sealed (%v)", sealed, err)
	}

	// Without a restart, the provider signs people in.
	bob := c.fork()
	bob.hc.CheckRedirect = c.hc.CheckRedirect
	if loc := ssoSignIn(t, bob, idp, "sub-bob", "bob@example.com"); loc != "/" {
		t.Fatalf("SSO sign-in landed on %q", loc)
	}
	v, raw = readSSO(t, c.do(http.MethodGet, "/api/v1/admin/oidc", nil, false))
	if v.LinkedUsers != 1 || strings.Contains(raw, "very-secret") {
		t.Fatalf("view = %s", raw)
	}

	// An empty secret keeps the saved one: the provider still has to answer.
	in := ssoInput(idp.srv.URL, "")
	in["name"] = "Authelia 2"
	if v, _ := readSSO(t, c.do(http.MethodPut, "/api/v1/admin/oidc", in, true)); !v.HasSecret || v.Name != "Authelia 2" || v.LinkedUsers != 1 {
		t.Fatalf("save without a secret = %+v", v)
	}

	// Another issuer: the links of the first one go.
	other := newFakeIDP(t)
	if v, _ := readSSO(t, c.do(http.MethodPut, "/api/v1/admin/oidc", ssoInput(other.srv.URL, ""), true)); v.Issuer != other.srv.URL || v.LinkedUsers != 0 {
		t.Fatalf("issuer change = %+v", v)
	}
	var left int
	_ = c.st.Read().QueryRow("SELECT COUNT(*) FROM user_oidc_identities").Scan(&left)
	if left != 0 {
		t.Fatalf("links left after the issuer change = %d", left)
	}

	// Turning it off takes effect at once too.
	resp := c.do(http.MethodDelete, "/api/v1/admin/oidc", nil, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("turn off = %d", resp.StatusCode)
	}
	if on, _ := ssoEnabled(t, c); on {
		t.Fatal("SSO still on after turning it off")
	}
}

func TestOIDCSettingsChecksTheInput(t *testing.T) {
	withSecretKey(t)
	c := newOIDCSettingsAPI(t, nil)
	for _, tc := range []map[string]any{
		{"issuer": "ftp://idp.example"},
		{"redirectUrl": "http://cloudbank.test/elsewhere"},
		{"redirectUrl": "/api/v1/auth/oidc/callback"},
		{"scopes": "profile email"},
		{"clientSecret": ""}, // nothing saved to keep
	} {
		in := ssoInput("https://idp.example", "s")
		for k, v := range tc {
			in[k] = v
		}
		if code := errorCode(t, c.do(http.MethodPut, "/api/v1/admin/oidc", in, true)); code != "invalid" {
			t.Errorf("%v = %q, want invalid", tc, code)
		}
	}
}

func TestOIDCSettingsNeedSecretKey(t *testing.T) {
	idp := newFakeIDP(t)
	c := newOIDCSettingsAPI(t, nil)
	if v, _ := readSSO(t, c.do(http.MethodGet, "/api/v1/admin/oidc", nil, false)); v.SecretKey || v.Source != "none" {
		t.Fatalf("view = %+v", v)
	}
	resp := c.do(http.MethodPut, "/api/v1/admin/oidc", ssoInput(idp.srv.URL, "s"), true)
	if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "secret_key_missing" {
		t.Fatalf("save without CB_SECRET_KEY = %d", resp.StatusCode)
	}
}

func TestOIDCSettingsAdminOnly(t *testing.T) {
	c := newOIDCSettingsAPI(t, nil)
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	for _, m := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		resp := bob.do(m, "/api/v1/admin/oidc", ssoInput("https://idp.example", "s"), true)
		if resp.StatusCode != http.StatusForbidden || errorCode(t, resp) != "forbidden" {
			t.Errorf("bob %s = %d, want 403 forbidden as on /admin/users", m, resp.StatusCode)
		}
	}
}

// Signing in through SSO alone, turning it off would leave nobody a way in.
func TestOIDCSettingsSSOOnlyRefusesTurningOff(t *testing.T) {
	withSecretKey(t)
	idp := newFakeIDP(t)
	c := newOIDCSettingsAPI(t, func(o *Options, s *oidc.Store) {
		saved := oidc.Settings{Config: oidc.Config{Issuer: idp.srv.URL, ClientID: "cloudbank", ClientSecret: "s", RedirectURL: testCallback, Name: "Authelia"}}
		if err := s.Save(context.Background(), saved); err != nil {
			t.Fatal(err)
		}
		o.SSOOnly, o.OIDC = true, oidc.New(saved.Config)
	})
	if loc := ssoSignIn(t, c, idp, "sub-ann", "ann@example.com"); loc != "/" {
		t.Fatalf("first SSO sign-in landed on %q", loc)
	}
	resp := c.do(http.MethodDelete, "/api/v1/admin/oidc", nil, true)
	if resp.StatusCode != http.StatusConflict || errorCode(t, resp) != "sso_only" {
		t.Fatalf("turn off = %d", resp.StatusCode)
	}
	if on, _ := ssoEnabled(t, c); !on {
		t.Fatal("SSO went off")
	}
}
