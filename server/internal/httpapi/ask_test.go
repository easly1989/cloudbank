package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

// A question about the wallet: two calls, the numbers computed by CloudBank;
// the AI or the switch off asks nothing; a stranger to the wallet gets 404.
func TestAIAsk(t *testing.T) {
	c := newTestAPI(t)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		calls.Add(1)
		reply := `It was 12.50.`
		if strings.Contains(string(b), "read-only queries") {
			reply = `{\"tools\":[{\"tool\":\"total\",\"from\":\"2026-01-01\",\"to\":\"2026-12-31\",\"type\":\"expense\"}]}`
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"` + reply + `"}}]}`))
	}))
	t.Cleanup(srv.Close)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)
	c.do(http.MethodPost, base+"/transactions", map[string]any{"accountId": acc, "date": "2026-03-02", "amount": -1250, "memo": "x"}, true).Body.Close()
	ask := func(cl *testClient) (int, map[string]any) {
		t.Helper()
		r := cl.do(http.MethodPost, base+"/insights/ask", map[string]any{"question": "How much did I spend in 2026?"}, true)
		defer r.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(r.Body).Decode(&out)
		return r.StatusCode, out
	}
	settings := func(on bool) {
		t.Helper()
		r := c.do(http.MethodPut, "/api/v1/ai/settings", map[string]any{
			"enabled": true, "baseUrl": srv.URL, "model": "m", "apiKey": "k", "features": map[string]bool{"ask": on},
		}, true)
		r.Body.Close()
		if r.StatusCode != http.StatusOK {
			t.Fatalf("settings = %d", r.StatusCode)
		}
	}
	if code, out := ask(c); code != http.StatusBadRequest || codeOf(out) != "ai_disabled" {
		t.Fatalf("AI off = %d %v", code, out)
	}
	settings(false)
	if code, out := ask(c); code != http.StatusBadRequest || codeOf(out) != "ai_disabled" || calls.Load() != 0 {
		t.Fatalf("switch off = %d %v (%d calls)", code, out, calls.Load())
	}
	settings(true)
	code, out := ask(c)
	used, _ := out["used"].([]any)
	if code != http.StatusOK || out["answer"] != "It was 12.50." || len(used) != 1 || calls.Load() != 2 {
		t.Fatalf("ask = %d %v (%d calls)", code, out, calls.Load())
	}
	if u := used[0].(map[string]any); u["tool"] != "total" || u["total"] != float64(-1250) || u["count"] != float64(1) {
		t.Fatalf("used = %v", u)
	}
	r := c.do(http.MethodPost, base+"/insights/ask", map[string]any{"question": strings.Repeat("a", 301)}, true)
	r.Body.Close()
	if r.StatusCode != http.StatusBadRequest {
		t.Fatalf("too long = %d", r.StatusCode)
	}
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	eve := c.fork()
	eve.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "eve", "password": "evessecret"}, true).Body.Close()
	if code, _ := ask(eve); code != http.StatusNotFound {
		t.Fatalf("eve = %d, want 404", code)
	}
}
