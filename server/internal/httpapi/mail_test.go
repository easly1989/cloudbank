package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/secrets"
)

func TestMailNeedsSecretKey(t *testing.T) {
	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/mail"

	resp := c.do(http.MethodGet, base, nil, false)
	var ov struct {
		Available bool              `json:"available"`
		Mailboxes []json.RawMessage `json:"mailboxes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ov); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if ov.Available || ov.Mailboxes == nil || len(ov.Mailboxes) != 0 {
		t.Fatalf("overview = %+v", ov)
	}

	// The server refuses, not just the interface: nothing would seal the token.
	resp = c.do(http.MethodPost, base+"/microsoft", map[string]any{}, true)
	defer resp.Body.Close()
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&e)
	if resp.StatusCode != http.StatusConflict || e.Error.Code != "unavailable" {
		t.Fatalf("start without key = %d %q, want 409 unavailable", resp.StatusCode, e.Error.Code)
	}
}

func TestMailStaysInItsWallet(t *testing.T) {
	k, err := secrets.New("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	secrets.Configure(k)
	t.Cleanup(func() { secrets.Configure(nil) })

	admin := newTestAPI(t)
	wid := createWalletWithBase(t, admin, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/mail"

	admin.do(http.MethodPost, "/api/v1/admin/users",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := admin.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login",
		map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()

	for _, r := range []struct{ method, path string }{
		{http.MethodGet, base},
		{http.MethodPost, base + "/microsoft"},
		{http.MethodPost, base + "/microsoft/abc/poll"},
		{http.MethodGet, base + "/mailboxes/1/folders"},
		{http.MethodPatch, base + "/mailboxes/1"},
		{http.MethodPost, base + "/mailboxes/1/check"},
		{http.MethodGet, base + "/mailboxes/1/messages"},
		{http.MethodDelete, base + "/mailboxes/1"},
	} {
		resp := bob.do(r.method, r.path, map[string]any{}, true)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("bob %s %s = %d, want 404", r.method, r.path, resp.StatusCode)
		}
	}

	// The owner gets a plain 404 for a mailbox that does not exist, and for a
	// sign-in that was never started.
	if resp := admin.do(http.MethodPost, base+"/mailboxes/99/check", nil, true); resp.StatusCode != http.StatusNotFound {
		t.Errorf("missing mailbox = %d", resp.StatusCode)
	}
	resp := admin.do(http.MethodPost, base+"/microsoft/nope/poll", nil, true)
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&e)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound || e.Error.Code != "flow_not_found" {
		t.Errorf("unknown sign-in = %d %q", resp.StatusCode, e.Error.Code)
	}
}
