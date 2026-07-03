package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

type tagInfo struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

func decodeTagInfos(t *testing.T, resp *http.Response) []tagInfo {
	t.Helper()
	defer resp.Body.Close()
	var out []tagInfo
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode tag infos: %v", err)
	}
	return out
}

func TestTagManagement(t *testing.T) {
	c := newTestAPI(t)
	wid, acc := makeAccount(t, c)
	base := "/api/v1/wallets/" + strconv.FormatInt(wid, 10)

	// A transaction carrying two on-the-fly tags creates them.
	tr := c.do(http.MethodPost, base+"/transactions", map[string]any{
		"accountId": acc, "date": "2026-02-01", "amount": -1000, "tags": []string{"food", "fun"},
	}, true)
	if tr.StatusCode != http.StatusCreated {
		t.Fatalf("create txn = %d", tr.StatusCode)
	}
	tr.Body.Close()

	// /tags/manage returns each tag with its id and usage count.
	manage := decodeTagInfos(t, c.do(http.MethodGet, base+"/tags/manage", nil, false))
	if len(manage) != 2 {
		t.Fatalf("manage = %+v, want 2", manage)
	}
	byName := map[string]tagInfo{}
	for _, ti := range manage {
		byName[ti.Name] = ti
	}
	food, fun := byName["food"], byName["fun"]
	if food.ID == 0 || fun.ID == 0 || food.Count != 1 {
		t.Fatalf("tag infos = %+v", manage)
	}

	// Rename "food" → "grocery" (204).
	if r := c.do(http.MethodPatch, base+"/tags/"+strconv.FormatInt(food.ID, 10),
		map[string]any{"name": "grocery"}, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("rename = %d, want 204", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// Renaming "fun" onto the now-existing "grocery" collides → 409.
	if r := c.do(http.MethodPatch, base+"/tags/"+strconv.FormatInt(fun.ID, 10),
		map[string]any{"name": "grocery"}, true); r.StatusCode != http.StatusConflict {
		t.Fatalf("rename collide = %d, want 409", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// A bad tag id → 404.
	if r := c.do(http.MethodPatch, base+"/tags/999999", map[string]any{"name": "x"}, true); r.StatusCode != http.StatusNotFound {
		t.Fatalf("rename missing = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}

	// Merge "fun" into "grocery" (204) → one tag remains.
	if r := c.do(http.MethodPost, base+"/tags/"+strconv.FormatInt(fun.ID, 10)+"/merge",
		map[string]any{"targetId": food.ID}, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("merge = %d, want 204", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if after := decodeTagInfos(t, c.do(http.MethodGet, base+"/tags/manage", nil, false)); len(after) != 1 {
		t.Fatalf("after merge = %+v, want 1", after)
	}

	// Delete the survivor (204).
	if r := c.do(http.MethodDelete, base+"/tags/"+strconv.FormatInt(food.ID, 10), nil, true); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204", r.StatusCode)
	} else {
		r.Body.Close()
	}
	if after := decodeTagInfos(t, c.do(http.MethodGet, base+"/tags/manage", nil, false)); len(after) != 0 {
		t.Fatalf("after delete = %+v, want 0", after)
	}

	// Cross-user isolation: a non-member gets 404 on tag routes.
	c.do(http.MethodPost, "/api/v1/admin/users", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	bob := c.fork()
	bob.do(http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "bob", "password": "bobssecret"}, true).Body.Close()
	if r := bob.do(http.MethodGet, base+"/tags/manage", nil, false); r.StatusCode != http.StatusNotFound {
		t.Fatalf("bob manage = %d, want 404", r.StatusCode)
	} else {
		r.Body.Close()
	}
}
