package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

// The payee cleanup (#708) over HTTP: apply, read the last one, undo it; and
// the routes are the wallet's members' alone.
func TestPayeeCleanup(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	id := func(path string, body map[string]any) int64 {
		t.Helper()
		return int64(decodeTxn(t, c.do(http.MethodPost, path, body, true))["id"].(float64))
	}
	raw1 := id(base+"/payees", map[string]any{"name": "AMZN MKTP IT*2K3"})
	raw2 := id(base+"/payees", map[string]any{"name": "AMZN MKTP IT*7H1"})
	txn := id(base+"/transactions", map[string]any{"accountId": acc, "date": "2026-10-01", "amount": -100, "payeeId": raw2})
	last := func(cl *testClient) (int, map[string]any) {
		r := cl.do(http.MethodGet, base+"/payees/cleanup", nil, false)
		defer r.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out
	}
	if _, out := last(c); out["cleanup"] != nil {
		t.Fatalf("before = %v, want no cleanup", out)
	}

	groups := map[string]any{"groups": []map[string]any{{"name": "Amazon", "payeeIds": []int64{raw1, raw2}, "rule": "AMZN MKTP"}}}

	// Bob, no member of the wallet, sees none of it.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	for _, r := range []*http.Response{
		bob.do(http.MethodPost, base+"/payees/cleanup", groups, true),
		bob.do(http.MethodGet, base+"/payees/cleanup", nil, false),
		bob.do(http.MethodDelete, base+"/payees/cleanup", nil, true),
		bob.do(http.MethodPost, base+"/ai/payee-cleanup", map[string]any{}, true),
	} {
		r.Body.Close()
		if r.StatusCode != http.StatusNotFound {
			t.Fatalf("bob %s %s = %d, want 404", r.Request.Method, r.Request.URL.Path, r.StatusCode)
		}
	}
	// The AI switched off: the proposal says so.
	if r := c.do(http.MethodPost, base+"/ai/payee-cleanup", map[string]any{}, true); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("proposal with the AI off = %d, want 400", r.StatusCode)
	} else {
		r.Body.Close()
	}

	r := c.do(http.MethodPost, base+"/payees/cleanup", groups, true)
	r.Body.Close()
	if r.StatusCode != http.StatusOK {
		t.Fatalf("cleanup = %d, want 200", r.StatusCode)
	}
	if got := decodeTxn(t, c.do(http.MethodGet, base+"/transactions/"+strconv.FormatInt(txn, 10), nil, false)); got["payeeId"] != float64(raw1) {
		t.Fatalf("transaction payee = %v, want the clean payee %d", got["payeeId"], raw1)
	}
	if _, out := last(c); out["cleanup"].(map[string]any)["rules"] != float64(1) {
		t.Fatalf("last = %v", out)
	}
	bad := c.do(http.MethodPost, base+"/payees/cleanup", map[string]any{"groups": []map[string]any{{"name": "", "payeeIds": []int64{raw1}}}}, true)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad cleanup = %d, want 400", bad.StatusCode)
	}

	undo := c.do(http.MethodDelete, base+"/payees/cleanup", nil, true)
	undo.Body.Close()
	if undo.StatusCode != http.StatusNoContent {
		t.Fatalf("undo = %d, want 204", undo.StatusCode)
	}
	if got := decodeTxn(t, c.do(http.MethodGet, base+"/transactions/"+strconv.FormatInt(txn, 10), nil, false)); got["payeeId"] != float64(raw2) {
		t.Fatalf("after undo payee = %v, want %d", got["payeeId"], raw2)
	}
	again := c.do(http.MethodDelete, base+"/payees/cleanup", nil, true)
	again.Body.Close()
	if again.StatusCode != http.StatusNotFound {
		t.Fatalf("second undo = %d, want 404", again.StatusCode)
	}
}
