package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/secrets"
	"github.com/easly1989/cloudbank/server/internal/store/db"
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
		{http.MethodGet, base + "/mailboxes/1/messages/1"},
		{http.MethodGet, base + "/mailboxes/1/patterns"},
		{http.MethodPost, base + "/mailboxes/1/patterns"},
		{http.MethodPut, base + "/mailboxes/1/patterns/order"},
		{http.MethodPost, base + "/mailboxes/1/patterns/test"},
		{http.MethodPut, base + "/mailboxes/1/patterns/1"},
		{http.MethodDelete, base + "/mailboxes/1/patterns/1"},
		{http.MethodPost, base + "/mailboxes/1/patterns/1/apply"},
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

// A pattern is checked by the server, not only by the editor: an expression
// that does not compile is refused with the reason, and nothing is saved.
func TestMailPatternsAreCheckedByTheServer(t *testing.T) {
	k, err := secrets.New("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	secrets.Configure(k)
	t.Cleanup(func() { secrets.Configure(nil) })

	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	ws := strconv.FormatInt(wid, 10)
	resp := c.do(http.MethodPost, "/api/v1/wallets/"+ws+"/accounts", map[string]any{"name": "Conto", "type": "bank"}, true)
	var acc struct {
		ID int64 `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&acc)
	resp.Body.Close()
	accID := acc.ID
	ctx := context.Background()
	mb, err := db.New(c.st.Write()).InsertMailbox(ctx, db.InsertMailboxParams{
		WalletID: wid, Provider: "microsoft", Address: "notifiche.demo@example.com", Secret: "x",
	})
	if err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/wallets/" + ws + "/mail/mailboxes/" + strconv.FormatInt(mb.ID, 10) + "/patterns"
	pattern := func(body string) map[string]any {
		return map[string]any{"sender": "avvisi@banca.example", "body": body, "accountId": accID}
	}

	resp = c.do(http.MethodPost, base, pattern(`pagato (?P<amount>[\d.,+) EUR`), true)
	var e struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&e)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || e.Error.Code != "invalid_expression" ||
		e.Error.Message != "missing closing ]: `[\\d.,+) EUR`" {
		t.Fatalf("invalid expression = %d %+v", resp.StatusCode, e.Error)
	}

	// What the body leaves out takes the safe value.
	resp = c.do(http.MethodPost, base, pattern(`pagato (?P<amount>[\d.,]+) EUR`), true)
	var saved struct {
		ID          int64  `json:"id"`
		Direction   string `json:"direction"`
		RequireAuth bool   `json:"requireAuth"`
		ApplyRules  bool   `json:"applyRules"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&saved)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || saved.Direction != "out" || !saved.RequireAuth || !saved.ApplyRules {
		t.Fatalf("create = %d %+v", resp.StatusCode, saved)
	}
	resp = c.do(http.MethodGet, base, nil, false)
	var list []json.RawMessage
	_ = json.NewDecoder(resp.Body).Decode(&list)
	resp.Body.Close()
	if len(list) != 1 {
		t.Fatalf("patterns = %d, want only the valid one", len(list))
	}
}
