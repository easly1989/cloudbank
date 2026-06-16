package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/category"
	"github.com/easly1989/cloudbank/server/internal/currency"
	"github.com/easly1989/cloudbank/server/internal/payee"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/wallet"
)

type testClient struct {
	t    *testing.T
	base string
	hc   *http.Client
}

func newTestAPI(t *testing.T) *testClient {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	svc := auth.NewService(db.New(st.Write()))
	wsvc := wallet.NewService(st.Write())
	csvc := currency.NewService(st.Write())
	asvc := account.NewService(st.Write())
	catsvc := category.NewService(st.Write())
	psvc := payee.NewService(st.Write())
	srv := httptest.NewServer(New(Options{
		Auth: svc, Wallets: wsvc, Currencies: csvc, Accounts: asvc,
		Categories: catsvc, Payees: psvc, Health: st,
	}))
	t.Cleanup(srv.Close)

	jar, _ := cookiejar.New(nil)
	return &testClient{t: t, base: srv.URL, hc: &http.Client{Jar: jar}}
}

// fork returns a second client against the same server with its own cookie jar,
// for testing cross-user isolation.
func (c *testClient) fork() *testClient {
	jar, _ := cookiejar.New(nil)
	return &testClient{t: c.t, base: c.base, hc: &http.Client{Jar: jar}}
}

// do issues a request. When csrf is true the X-Requested-With header is sent.
func (c *testClient) do(method, path string, body any, csrf bool) *http.Response {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		c.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if csrf {
		req.Header.Set("X-Requested-With", "XMLHttpRequest")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	return resp
}

func decodeUser(t *testing.T, resp *http.Response) userResponse {
	t.Helper()
	defer resp.Body.Close()
	var u userResponse
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	return u
}

func needsSetup(t *testing.T, c *testClient) bool {
	t.Helper()
	resp := c.do(http.MethodGet, "/api/v1/setup/status", nil, false)
	defer resp.Body.Close()
	var out struct {
		NeedsSetup bool `json:"needsSetup"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.NeedsSetup
}

func TestSetupAndAuthFlow(t *testing.T) {
	c := newTestAPI(t)

	if !needsSetup(t, c) {
		t.Fatal("fresh instance should need setup")
	}

	// Complete setup → creates admin and logs in (cookie set on the jar).
	resp := c.do(http.MethodPost, "/api/v1/setup",
		map[string]any{"username": "admin", "email": "a@b.c", "password": "supersecret"}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("setup status = %d, want 201", resp.StatusCode)
	}
	admin := decodeUser(t, resp)
	if !admin.IsAdmin {
		t.Fatal("setup user is not admin")
	}

	if needsSetup(t, c) {
		t.Fatal("instance still needs setup after setup")
	}

	// /auth/me returns the logged-in admin.
	resp = c.do(http.MethodGet, "/api/v1/auth/me", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("me status = %d, want 200", resp.StatusCode)
	}
	if u := decodeUser(t, resp); u.Username != "admin" {
		t.Fatalf("me username = %q", u.Username)
	}

	// Setup is one-shot.
	resp = c.do(http.MethodPost, "/api/v1/setup",
		map[string]any{"username": "x", "password": "supersecret"}, true)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("second setup status = %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()

	// Logout → /auth/me is now unauthorized.
	resp = c.do(http.MethodPost, "/api/v1/auth/logout", nil, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()
	resp = c.do(http.MethodGet, "/api/v1/auth/me", nil, false)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("me after logout = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	// Wrong then right login.
	resp = c.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "admin", "password": "nope"}, true)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad login = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	resp = c.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "admin", "password": "supersecret"}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("good login = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestCSRFRejectsMissingHeader(t *testing.T) {
	c := newTestAPI(t)
	resp := c.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "admin", "password": "supersecret"}, false)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("login without X-Requested-With = %d, want 403", resp.StatusCode)
	}
}

func TestNoSelfRegistration(t *testing.T) {
	c := newTestAPI(t)
	// There is no register endpoint; the SPA cannot create accounts.
	resp := c.do(http.MethodPost, "/api/v1/auth/register",
		map[string]any{"username": "x", "password": "supersecret"}, true)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("register endpoint = %d, want 404 (does not exist)", resp.StatusCode)
	}
}

func TestAdminEndpointsRequireAdmin(t *testing.T) {
	c := newTestAPI(t)
	// Admin setup.
	resp := c.do(http.MethodPost, "/api/v1/setup",
		map[string]any{"username": "admin", "password": "supersecret"}, true)
	resp.Body.Close()

	// Admin creates a non-admin user.
	resp = c.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret", "isAdmin": false}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create user = %d, want 201", resp.StatusCode)
	}
	bob := decodeUser(t, resp)

	// Admin lists users (admin + bob).
	resp = c.do(http.MethodGet, "/api/v1/admin/users", nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list users = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	// Log out admin, log in as bob (non-admin).
	c.do(http.MethodPost, "/api/v1/auth/logout", nil, true).Body.Close()
	resp = c.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true)
	resp.Body.Close()

	// Bob cannot reach admin endpoints.
	resp = c.do(http.MethodGet, "/api/v1/admin/users", nil, false)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("bob list users = %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// Log back in as admin, disable bob.
	c.do(http.MethodPost, "/api/v1/auth/logout", nil, true).Body.Close()
	c.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "admin", "password": "supersecret"}, true).Body.Close()
	resp = c.do(http.MethodPost, "/api/v1/admin/users/"+strconv.FormatInt(bob.ID, 10)+"/disable",
		map[string]any{"disabled": true}, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("disable bob = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()

	// Disabled bob can no longer log in.
	c.do(http.MethodPost, "/api/v1/auth/logout", nil, true).Body.Close()
	resp = c.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("disabled bob login = %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
}
