package httpapi

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/oidc"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// fakeIDP is a minimal OIDC provider: discovery, keys, and a token endpoint
// that signs an ID token for whoever the test says signed in. The authorize
// step is the test itself, reading the redirect CloudBank sends.
type fakeIDP struct {
	t   *testing.T
	srv *httptest.Server
	key *rsa.PrivateKey

	mu    sync.Mutex
	codes map[string]fakeGrant
	down  bool
	// userInfoOnly keeps the email out of the ID token and serves it at the
	// userinfo endpoint, as Authelia does by default since 4.39.
	userInfoOnly bool
	tokens       map[string]fakeGrant
}

type fakeGrant struct {
	nonce, challenge string
	sub, email       string
}

func newFakeIDP(t *testing.T) *fakeIDP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIDP{t: t, key: key, codes: map[string]fakeGrant{}, tokens: map[string]fakeGrant{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		f.mu.Lock()
		down := f.down
		f.mu.Unlock()
		if down {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"issuer":                                f.srv.URL,
			"authorization_endpoint":                f.srv.URL + "/authorize",
			"token_endpoint":                        f.srv.URL + "/token",
			"jwks_uri":                              f.srv.URL + "/keys",
			"userinfo_endpoint":                     f.srv.URL + "/userinfo",
			"response_types_supported":              []string{"code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "k1",
			"n": b64(key.N.Bytes()), "e": b64(big.NewInt(int64(key.E)).Bytes()),
		}}})
	})
	mux.HandleFunc("/token", f.token)
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		g, ok := f.tokens[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
		f.mu.Unlock()
		if !ok {
			http.Error(w, "unknown token", http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"sub": g.sub, "email": g.email, "email_verified": true})
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func (f *fakeIDP) setDown(down bool) {
	f.mu.Lock()
	f.down = down
	f.mu.Unlock()
}

// authorize plays the provider's sign-in page: it takes the authorization URL
// CloudBank redirected to, "signs in" sub/email, and returns the callback query.
func (f *fakeIDP) authorize(authURL, sub, email string) url.Values {
	f.t.Helper()
	u, err := url.Parse(authURL)
	if err != nil || !strings.HasPrefix(authURL, f.srv.URL+"/authorize") {
		f.t.Fatalf("not an authorize URL: %q", authURL)
	}
	q := u.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" {
		f.t.Fatalf("no PKCE S256 challenge in %q", authURL)
	}
	code := oidcRandom()
	f.mu.Lock()
	f.codes[code] = fakeGrant{nonce: q.Get("nonce"), challenge: q.Get("code_challenge"), sub: sub, email: email}
	f.mu.Unlock()
	return url.Values{"code": {code}, "state": {q.Get("state")}}
}

func (f *fakeIDP) token(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	f.mu.Lock()
	g, ok := f.codes[r.PostForm.Get("code")]
	delete(f.codes, r.PostForm.Get("code"))
	f.mu.Unlock()
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if !ok || b64(sum[:]) != g.challenge {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	now := time.Now()
	idClaims := map[string]any{
		"iss": f.srv.URL, "sub": g.sub, "aud": "cloudbank", "nonce": g.nonce,
		"iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	}
	f.mu.Lock()
	if !f.userInfoOnly {
		idClaims["email"], idClaims["email_verified"] = g.email, true
	}
	access := oidcRandom()
	f.tokens[access] = g
	f.mu.Unlock()
	claims, _ := json.Marshal(idClaims)
	head, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "k1", "typ": "JWT"})
	signing := b64(head) + "." + b64(claims)
	digest := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
	if err != nil {
		f.t.Error(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": access, "token_type": "Bearer", "expires_in": 300,
		"id_token": signing + "." + b64(sig),
	})
}

func oidcRandom() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return b64(b)
}

// newSSOOnlyAPI is a server with the password login off, signing in through idp.
func newSSOOnlyAPI(t *testing.T, idp *fakeIDP, adminEmail string) *testClient {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := httptest.NewServer(New(Options{
		Auth: auth.NewService(db.New(st.Write())),
		OIDC: oidc.New(oidc.Config{
			Issuer: idp.srv.URL, ClientID: "cloudbank", ClientSecret: "s",
			RedirectURL: "http://cloudbank.test/api/v1/auth/oidc/callback", Name: "Authelia",
		}),
		SSOOnly:        true,
		OIDCAdminEmail: adminEmail,
	}))
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	hc := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	return &testClient{t: t, base: srv.URL, hc: hc}
}

// ssoSignIn walks the whole SSO round trip for sub/email and returns where
// CloudBank sent the browser at the end: "/" on success, the login page with
// sso_error otherwise.
func ssoSignIn(t *testing.T, c *testClient, idp *fakeIDP, sub, email string) string {
	t.Helper()
	resp := c.do(http.MethodGet, "/api/v1/auth/oidc/start", nil, false)
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("start = %d; want 302", resp.StatusCode)
	}
	loc := resp.Header.Get("Location")
	if strings.HasPrefix(loc, "/login") {
		return loc
	}
	q := idp.authorize(loc, sub, email)
	resp = c.do(http.MethodGet, "/api/v1/auth/oidc/callback?"+q.Encode(), nil, false)
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("callback = %d; want 302", resp.StatusCode)
	}
	return resp.Header.Get("Location")
}

func TestSSOOnlyConfigAndPasswordEndpoints(t *testing.T) {
	idp := newFakeIDP(t)
	c := newSSOOnlyAPI(t, idp, "")

	resp := c.do(http.MethodGet, "/api/v1/auth/config", nil, false)
	var cfg struct {
		OIDC struct {
			Enabled bool   `json:"enabled"`
			Name    string `json:"name"`
		} `json:"oidc"`
		PasswordLogin bool `json:"passwordLogin"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&cfg)
	resp.Body.Close()
	if !cfg.OIDC.Enabled || cfg.OIDC.Name != "Authelia" || cfg.PasswordLogin {
		t.Fatalf("config = %+v; want SSO on, named Authelia, no password login", cfg)
	}

	for _, path := range []string{"/api/v1/setup", "/api/v1/auth/login"} {
		resp := c.do(http.MethodPost, path, map[string]any{"username": "a", "password": "supersecret"}, true)
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s = %d; want 403", path, resp.StatusCode)
		}
	}
	if !needsSetup(t, c) {
		t.Fatal("refused setup created a user")
	}
}

func TestSSOOnlyFirstAdminAndRecoveryCodes(t *testing.T) {
	idp := newFakeIDP(t)
	c := newSSOOnlyAPI(t, idp, "ann@example.com")

	// Someone else gets there first: refused, the server still needs its admin.
	if loc := ssoSignIn(t, newSSOClientLike(c), idp, "sub-eve", "eve@example.com"); loc != "/login?sso_error=account" {
		t.Fatalf("other email landed on %q; want the account error", loc)
	}
	if !needsSetup(t, c) {
		t.Fatal("a refused sign-in set the server up")
	}

	// The reserved email becomes the administrator.
	if loc := ssoSignIn(t, c, idp, "sub-ann", "ann@example.com"); loc != "/" {
		t.Fatalf("admin sign-in landed on %q; want /", loc)
	}
	me := decodeUser(t, c.do(http.MethodGet, "/api/v1/auth/me", nil, false))
	if !me.IsAdmin || me.Username != "ann" {
		t.Fatalf("me = %+v; want admin ann", me)
	}

	// The password and two-factor endpoints are off for the signed-in user too.
	for _, path := range []string{"/api/v1/auth/me/password", "/api/v1/auth/2fa/setup"} {
		resp := c.do(http.MethodPost, path, map[string]any{}, true)
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s = %d; want 403", path, resp.StatusCode)
		}
	}

	// People: a user is created with an email and no password.
	resp := c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob"}, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("user without email = %d; want 400", resp.StatusCode)
	}
	resp = c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "email": "bob@example.com"}, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("user with email = %d; want 201", resp.StatusCode)
	}
	bob := newSSOClientLike(c)
	if loc := ssoSignIn(t, bob, idp, "sub-bob", "bob@example.com"); loc != "/" {
		t.Fatalf("bob landed on %q; want /", loc)
	}
	if u := decodeUser(t, bob.do(http.MethodGet, "/api/v1/auth/me", nil, false)); u.Username != "bob" || u.IsAdmin {
		t.Fatalf("bob = %+v; want non-admin bob", u)
	}

	// Ann keeps ten codes.
	resp = c.do(http.MethodPost, "/api/v1/auth/me/access-codes", nil, true)
	var made struct {
		Codes []string `json:"codes"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&made)
	resp.Body.Close()
	if len(made.Codes) != 10 {
		t.Fatalf("codes = %v; want ten", made.Codes)
	}

	// On another device, without the provider: a code lets her in, once.
	stranded := newSSOClientLike(c)
	resp = stranded.do(http.MethodPost, "/api/v1/auth/recovery", map[string]any{"username": "ann", "code": made.Codes[0]}, true)
	var in struct {
		User      userResponse `json:"user"`
		Remaining int64        `json:"remaining"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&in)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || in.User.Username != "ann" || in.Remaining != 9 {
		t.Fatalf("recovery = %d %+v; want 200, ann, 9 left", resp.StatusCode, in)
	}
	if u := decodeUser(t, stranded.do(http.MethodGet, "/api/v1/auth/me", nil, false)); u.Username != "ann" {
		t.Fatalf("after recovery me = %+v; want ann", u)
	}
	resp = stranded.do(http.MethodGet, "/api/v1/auth/me/access-codes", nil, false)
	var status struct {
		Remaining int64 `json:"remaining"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&status)
	resp.Body.Close()
	if status.Remaining != 9 {
		t.Fatalf("remaining = %d; want 9", status.Remaining)
	}
	// The same code a second time does not.
	resp = c.fork().do(http.MethodPost, "/api/v1/auth/recovery", map[string]any{"username": "ann", "code": made.Codes[0]}, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused code = %d; want 401", resp.StatusCode)
	}
}

// A provider that is down while CloudBank starts only delays SSO: the start
// sends the browser back to the login page (which offers the recovery code),
// and once the provider answers, SSO works without a restart.
func TestSSOProviderDownAtStart(t *testing.T) {
	idp := newFakeIDP(t)
	idp.setDown(true)
	c := newSSOOnlyAPI(t, idp, "")
	if loc := ssoSignIn(t, c, idp, "sub-ann", "ann@example.com"); loc != "/login?sso_error=unavailable" {
		t.Fatalf("SSO with the provider down landed on %q; want the unavailable error", loc)
	}
	idp.setDown(false)
	if loc := ssoSignIn(t, c, idp, "sub-ann", "ann@example.com"); loc != "/" {
		t.Fatalf("SSO after the provider came back landed on %q; want /", loc)
	}
}

// newSSOClientLike is a fresh browser against the same server, not following
// redirects (the SSO round trip reads them).
func newSSOClientLike(c *testClient) *testClient {
	f := c.fork()
	f.hc.CheckRedirect = c.hc.CheckRedirect
	return f
}

// With the password login on, an empty installation is set up on the setup
// page: an SSO sign-in before that is refused rather than leaving the server
// without an administrator.
func TestSSOBeforeSetupRefusedWithPasswordLogin(t *testing.T) {
	idp := newFakeIDP(t)
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	srv := httptest.NewServer(New(Options{
		Auth: auth.NewService(db.New(st.Write())),
		OIDC: oidc.New(oidc.Config{
			Issuer: idp.srv.URL, ClientID: "cloudbank", ClientSecret: "s",
			RedirectURL: "http://cloudbank.test/api/v1/auth/oidc/callback", Name: "SSO",
		}),
		OIDCAutoProvision: true,
	}))
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	c := &testClient{t: t, base: srv.URL, hc: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}}
	if loc := ssoSignIn(t, c, idp, "sub-ann", "ann@example.com"); loc != "/login?sso_error=account" {
		t.Fatalf("SSO before setup landed on %q; want the account error", loc)
	}
	if !needsSetup(t, c) {
		t.Fatal("SSO before setup created a user")
	}
}

// A provider that gives the email only at its userinfo endpoint (Authelia's
// default since 4.39) still has it matched: here, to the reserved admin email.
func TestSSOEmailFromUserInfo(t *testing.T) {
	idp := newFakeIDP(t)
	idp.userInfoOnly = true
	c := newSSOOnlyAPI(t, idp, "ann@example.com")
	if loc := ssoSignIn(t, c, idp, "sub-ann", "ann@example.com"); loc != "/" {
		t.Fatalf("sign-in landed on %q; want /", loc)
	}
	if me := decodeUser(t, c.do(http.MethodGet, "/api/v1/auth/me", nil, false)); !me.IsAdmin || me.Email != "ann@example.com" {
		t.Fatalf("me = %+v; want admin ann@example.com", me)
	}
}
