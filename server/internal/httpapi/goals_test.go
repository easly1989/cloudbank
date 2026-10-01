package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

// A goal closes into the history on the client's date, refuses money while
// closed, and reopens (#572).
func TestGoalsCloseAndReopen(t *testing.T) {
	c := newTestAPI(t)
	wallet, _ := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wallet, 10) + "/goals"

	type goalOut struct {
		ID       int64   `json:"id"`
		Saved    int64   `json:"saved"`
		ClosedOn *string `json:"closedOn"`
	}
	call := func(method, path string, body any, want int) (goalOut, string) {
		t.Helper()
		resp := c.do(method, path, body, true)
		defer resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("%s %s = %d, want %d", method, path, resp.StatusCode, want)
		}
		var raw json.RawMessage
		_ = json.NewDecoder(resp.Body).Decode(&raw)
		var g goalOut
		_ = json.Unmarshal(raw, &g)
		var e struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return g, e.Error.Code
	}

	g, _ := call(http.MethodPost, base, map[string]any{"name": "Tickets", "targetAmount": 12000}, http.StatusCreated)
	if g.ClosedOn != nil {
		t.Fatalf("a new goal is open, got closedOn %q", *g.ClosedOn)
	}
	one := base + "/" + strconv.FormatInt(g.ID, 10)
	call(http.MethodPost, one+"/contributions", map[string]any{"date": "2026-09-15", "amount": 12000}, http.StatusCreated)

	if _, code := call(http.MethodPost, one+"/close", map[string]any{"date": "soon"}, http.StatusBadRequest); code != "invalid" {
		t.Fatalf("bad close date code = %q, want invalid", code)
	}
	call(http.MethodPost, base+"/999999/close", map[string]any{"date": "2026-10-01"}, http.StatusNotFound)

	closed, _ := call(http.MethodPost, one+"/close", map[string]any{"date": "2026-10-01"}, http.StatusOK)
	if closed.ClosedOn == nil || *closed.ClosedOn != "2026-10-01" || closed.Saved != 12000 {
		t.Fatalf("closed = %+v", closed)
	}
	if _, code := call(http.MethodPost, one+"/contributions", map[string]any{"date": "2026-10-02", "amount": 100}, http.StatusConflict); code != "goal_closed" {
		t.Fatalf("money into a closed goal code = %q, want goal_closed", code)
	}

	open, _ := call(http.MethodPost, one+"/reopen", nil, http.StatusOK)
	if open.ClosedOn != nil {
		t.Fatalf("reopened goal still closed on %q", *open.ClosedOn)
	}
	call(http.MethodPost, one+"/contributions", map[string]any{"date": "2026-10-02", "amount": 100}, http.StatusCreated)
}
