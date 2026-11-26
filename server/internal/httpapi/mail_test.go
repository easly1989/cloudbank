package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
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
		{http.MethodPost, base + "/imap"},
		{http.MethodGet, base + "/mailboxes/1/folders"},
		{http.MethodPatch, base + "/mailboxes/1"},
		{http.MethodPost, base + "/mailboxes/1/check"},
		{http.MethodGet, base + "/mailboxes/1/messages"},
		{http.MethodDelete, base + "/mailboxes/1"},
		{http.MethodGet, base + "/mailboxes/1/messages/1"},
		{http.MethodPost, base + "/mailboxes/1/sources"},
		{http.MethodPut, base + "/mailboxes/1/sources/order"},
		{http.MethodPatch, base + "/mailboxes/1/sources/1"},
		{http.MethodDelete, base + "/mailboxes/1/sources/1"},
		{http.MethodPut, base + "/mailboxes/1/sources/1/ai"},
		{http.MethodPost, base + "/mailboxes/1/sources/1/check"},
		{http.MethodGet, base + "/mailboxes/1/sources/1/patterns"},
		{http.MethodPost, base + "/mailboxes/1/sources/1/patterns"},
		{http.MethodPut, base + "/mailboxes/1/sources/1/patterns/order"},
		{http.MethodPost, base + "/mailboxes/1/sources/1/patterns/test"},
		{http.MethodPut, base + "/mailboxes/1/sources/1/patterns/1"},
		{http.MethodDelete, base + "/mailboxes/1/sources/1/patterns/1"},
		{http.MethodPost, base + "/mailboxes/1/sources/1/patterns/1/apply"},
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
	mb := insertMailbox(t, c, wid, "notifiche.demo@example.com", 1)
	base := "/api/v1/wallets/" + ws + "/mail/mailboxes/" + strconv.FormatInt(mb.id, 10) +
		"/sources/" + strconv.FormatInt(mb.sources[0], 10) + "/patterns"
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

// The connect form's server goes through the same guard as every address a
// user supplies, and its input is checked before anything is dialled.
func TestMailIMAPRefusesThisMachine(t *testing.T) {
	k, err := secrets.New("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	secrets.Configure(k)
	t.Cleanup(func() { secrets.Configure(nil) })

	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/mail"
	for _, tc := range []struct {
		body       map[string]any
		status     int
		code, text string
	}{
		{map[string]any{"address": "notifiche.demo@example.com", "password": "x", "host": "127.0.0.1", "port": 993, "security": "tls"},
			http.StatusBadRequest, "host_not_public", ""},
		{map[string]any{"address": "notifiche.demo@example.com", "password": "x", "host": "imap.example.com", "port": 143, "security": "none"},
			http.StatusBadRequest, "invalid", "the connection is encrypted with tls or starttls"},
	} {
		resp := c.do(http.MethodPost, base+"/imap", tc.body, true)
		var e struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&e)
		resp.Body.Close()
		if resp.StatusCode != tc.status || e.Error.Code != tc.code || (tc.text != "" && e.Error.Message != tc.text) {
			t.Errorf("%v = %d %+v", tc.body, resp.StatusCode, e.Error)
		}
	}
	resp := c.do(http.MethodGet, base, nil, false)
	var ov struct {
		Available bool              `json:"available"`
		Microsoft bool              `json:"microsoft"`
		Mailboxes []json.RawMessage `json:"mailboxes"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&ov)
	resp.Body.Close()
	if !ov.Available || !ov.Microsoft || len(ov.Mailboxes) != 0 {
		t.Fatalf("overview = %+v", ov)
	}
}

// A mode with the AI needs the AI set up by whoever connected the mailbox.
func TestMailAINeedsTheAISetUp(t *testing.T) {
	k, err := secrets.New("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	secrets.Configure(k)
	t.Cleanup(func() { secrets.Configure(nil) })

	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	mb := insertMailbox(t, c, wid, "notifiche.demo@example.com", 1)
	path := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/mail/mailboxes/" + strconv.FormatInt(mb.id, 10) +
		"/sources/" + strconv.FormatInt(mb.sources[0], 10) + "/ai"
	resp := c.do(http.MethodPut, path, map[string]any{"mode": "ai", "senders": []string{"banca.example"}}, true)
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&e)
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict || e.Error.Code != "ai_not_configured" {
		t.Fatalf("ai mode = %d %q, want 409 ai_not_configured", resp.StatusCode, e.Error.Code)
	}
	resp = c.do(http.MethodPut, path, map[string]any{"mode": "patterns"}, true)
	var got struct {
		ID int64 `json:"id"`
		AI struct {
			Mode string `json:"mode"`
		} `json:"ai"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&got)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || got.AI.Mode != "patterns" || got.ID != mb.sources[0] {
		t.Fatalf("patterns = %d %+v", resp.StatusCode, got)
	}
}

// testMailbox is a mailbox put straight in the database, with its sources.
type testMailbox struct {
	id      int64
	sources []int64
}

func insertMailbox(t *testing.T, c *testClient, wid int64, address string, sources int) testMailbox {
	t.Helper()
	ctx := context.Background()
	q := db.New(c.st.Write())
	mb, err := q.InsertMailbox(ctx, db.InsertMailboxParams{WalletID: wid, Provider: "microsoft", Address: address, Secret: "x"})
	if err != nil {
		t.Fatal(err)
	}
	out := testMailbox{id: mb.ID}
	for i := 0; i < sources; i++ {
		s, err := q.InsertMailSource(ctx, db.InsertMailSourceParams{MailboxID: mb.ID, Name: "Fonte " + strconv.Itoa(i+1), Folder: "INBOX"})
		if err != nil {
			t.Fatal(err)
		}
		out.sources = append(out.sources, s.ID)
	}
	return out
}

func errorCode(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&e)
	return e.Error.Code
}

// A mailbox has 1 to 5 sources with names of their own, and a source is
// reached only through its own mailbox.
func TestMailSourcesLimitsAndIsolation(t *testing.T) {
	k, err := secrets.New("test-secret-key")
	if err != nil {
		t.Fatal(err)
	}
	secrets.Configure(k)
	t.Cleanup(func() { secrets.Configure(nil) })

	c := newTestAPI(t)
	wid := createWalletWithBase(t, c, "EUR")
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10) + "/mail/mailboxes/"
	one := insertMailbox(t, c, wid, "uno.demo@example.com", 1)
	full := insertMailbox(t, c, wid, "pieno.demo@example.com", 5)
	oneBase := base + strconv.FormatInt(one.id, 10) + "/sources"
	fullBase := base + strconv.FormatInt(full.id, 10) + "/sources"

	for _, tc := range []struct {
		method, path string
		body         any
		status       int
		code         string
	}{
		{http.MethodPost, fullBase, map[string]any{"name": "Sesta", "folder": "INBOX"}, http.StatusConflict, "source_limit"},
		{http.MethodPost, oneBase, map[string]any{"name": " FONTE 1 ", "folder": "Banca"}, http.StatusConflict, "source_name_taken"},
		{http.MethodPost, oneBase, map[string]any{"name": " ", "folder": "Banca"}, http.StatusBadRequest, "invalid"},
		{http.MethodPatch, oneBase + "/" + strconv.FormatInt(one.sources[0], 10), map[string]any{"name": strings.Repeat("è", 61)}, http.StatusBadRequest, "invalid"},
		{http.MethodPatch, fullBase + "/" + strconv.FormatInt(full.sources[1], 10), map[string]any{"name": "fonte 1"}, http.StatusConflict, "source_name_taken"},
		{http.MethodDelete, oneBase + "/" + strconv.FormatInt(one.sources[0], 10), nil, http.StatusConflict, "last_source"},
		{http.MethodPut, oneBase + "/order", map[string]any{"ids": []int64{full.sources[0]}}, http.StatusBadRequest, "invalid"},
		// Another mailbox's source, through this one.
		{http.MethodPatch, oneBase + "/" + strconv.FormatInt(full.sources[0], 10), map[string]any{"name": "X"}, http.StatusNotFound, "not_found"},
		{http.MethodDelete, oneBase + "/" + strconv.FormatInt(full.sources[0], 10), nil, http.StatusNotFound, "not_found"},
		{http.MethodPut, oneBase + "/" + strconv.FormatInt(full.sources[0], 10) + "/ai", map[string]any{"mode": "patterns"}, http.StatusNotFound, "not_found"},
		{http.MethodPost, oneBase + "/" + strconv.FormatInt(full.sources[0], 10) + "/check", nil, http.StatusNotFound, "not_found"},
		{http.MethodGet, oneBase + "/" + strconv.FormatInt(full.sources[0], 10) + "/patterns", nil, http.StatusNotFound, "not_found"},
	} {
		resp := c.do(tc.method, tc.path, tc.body, tc.method != http.MethodGet)
		if code := errorCode(t, resp); resp.StatusCode != tc.status || code != tc.code {
			t.Errorf("%s %s = %d %q, want %d %q", tc.method, tc.path, resp.StatusCode, code, tc.status, tc.code)
		}
	}

	// Removing one of several works, and the rest stay in order.
	resp := c.do(http.MethodDelete, fullBase+"/"+strconv.FormatInt(full.sources[0], 10), nil, true)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	order := []int64{full.sources[4], full.sources[3], full.sources[2], full.sources[1]}
	resp = c.do(http.MethodPut, fullBase+"/order", map[string]any{"ids": order}, true)
	var mb struct {
		Sources []struct {
			ID   int64  `json:"id"`
			Mode string `json:"mode"`
		} `json:"sources"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&mb)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || len(mb.Sources) != 4 || mb.Sources[0].ID != order[0] || mb.Sources[3].ID != order[3] {
		t.Fatalf("reorder = %d %+v", resp.StatusCode, mb)
	}
}
