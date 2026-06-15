package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func decodeWallet(t *testing.T, resp *http.Response) walletResponse {
	t.Helper()
	defer resp.Body.Close()
	var w walletResponse
	if err := json.NewDecoder(resp.Body).Decode(&w); err != nil {
		t.Fatalf("decode wallet: %v", err)
	}
	return w
}

func decodeWallets(t *testing.T, resp *http.Response) []walletResponse {
	t.Helper()
	defer resp.Body.Close()
	var w []walletResponse
	if err := json.NewDecoder(resp.Body).Decode(&w); err != nil {
		t.Fatalf("decode wallets: %v", err)
	}
	return w
}

// setupAdmin completes first-run setup, leaving the client logged in as admin.
func setupAdmin(c *testClient) {
	c.do(http.MethodPost, "/api/v1/setup",
		map[string]any{"username": "admin", "password": "supersecret"}, true).Body.Close()
}

func TestWalletCreateListAndOwnership(t *testing.T) {
	c := newTestAPI(t)
	setupAdmin(c)

	// Create a wallet — the creator is its owner.
	resp := c.do(http.MethodPost, "/api/v1/wallets",
		map[string]any{"title": "Home", "ownerName": "Alice"}, true)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create wallet = %d, want 201", resp.StatusCode)
	}
	wlt := decodeWallet(t, resp)
	if wlt.Role != "owner" || wlt.Title != "Home" {
		t.Fatalf("created wallet = %+v", wlt)
	}

	// List returns it.
	wallets := decodeWallets(t, c.do(http.MethodGet, "/api/v1/wallets", nil, false))
	if len(wallets) != 1 || wallets[0].ID != wlt.ID {
		t.Fatalf("list wallets = %+v", wallets)
	}

	// Get + rename.
	resp = c.do(http.MethodGet, "/api/v1/wallets/"+strconv.FormatInt(wlt.ID, 10), nil, false)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get wallet = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
	resp = c.do(http.MethodPatch, "/api/v1/wallets/"+strconv.FormatInt(wlt.ID, 10),
		map[string]any{"title": "Household", "ownerName": "Alice"}, true)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch wallet = %d, want 200", resp.StatusCode)
	}
	if renamed := decodeWallet(t, resp); renamed.Title != "Household" {
		t.Fatalf("rename failed: %+v", renamed)
	}

	// Delete.
	resp = c.do(http.MethodDelete, "/api/v1/wallets/"+strconv.FormatInt(wlt.ID, 10), nil, true)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete wallet = %d, want 204", resp.StatusCode)
	}
	resp.Body.Close()
	if got := decodeWallets(t, c.do(http.MethodGet, "/api/v1/wallets", nil, false)); len(got) != 0 {
		t.Fatalf("wallets after delete = %+v, want empty", got)
	}
}

func TestWalletCrossUserIsolation(t *testing.T) {
	admin := newTestAPI(t)
	setupAdmin(admin)

	// Admin creates a wallet and a second (non-admin) user.
	w := decodeWallet(t, admin.do(http.MethodPost, "/api/v1/wallets",
		map[string]any{"title": "Admin wallet"}, true))
	admin.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret", "isAdmin": false}, true).Body.Close()

	// Bob logs in on his own client.
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	// Bob sees no wallets.
	if got := decodeWallets(t, bob.do(http.MethodGet, "/api/v1/wallets", nil, false)); len(got) != 0 {
		t.Fatalf("bob's wallet list = %+v, want empty", got)
	}

	// Bob cannot read, modify or delete the admin's wallet — all 404 (existence hidden).
	path := "/api/v1/wallets/" + strconv.FormatInt(w.ID, 10)
	for _, tc := range []struct {
		method string
		body   any
		csrf   bool
	}{
		{http.MethodGet, nil, false},
		{http.MethodPatch, map[string]any{"title": "hijack"}, true},
		{http.MethodDelete, nil, true},
	} {
		resp := bob.do(tc.method, path, tc.body, tc.csrf)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("bob %s wallet = %d, want 404", tc.method, resp.StatusCode)
		}
		resp.Body.Close()
	}

	// The admin's wallet is untouched.
	if got := decodeWallet(t, admin.do(http.MethodGet, path, nil, false)); got.Title != "Admin wallet" {
		t.Fatalf("admin wallet tampered: %+v", got)
	}
}

func TestWalletRequiresAuth(t *testing.T) {
	c := newTestAPI(t)
	setupAdmin(c)
	// Log out, then wallet endpoints require authentication.
	c.do(http.MethodPost, "/api/v1/auth/logout", nil, true).Body.Close()
	resp := c.do(http.MethodGet, "/api/v1/wallets", nil, false)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wallets while logged out = %d, want 401", resp.StatusCode)
	}
}
