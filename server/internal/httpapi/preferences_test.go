package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

// Two tabs start from the same revision: the first save lands, the second is
// refused instead of undoing it, and goes through once it starts again from
// the stored preferences. A client that sends no revision writes as before
// (#576).
func TestUpdateMePreferencesRevision(t *testing.T) {
	c := newTestAPI(t)
	setupAdmin(c)

	type me struct {
		Theme       string         `json:"theme"`
		Preferences map[string]any `json:"preferences"`
		Revision    int64          `json:"preferencesRevision"`
	}
	type errBody struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	patch := func(body map[string]any, want int) (me, string) {
		t.Helper()
		resp := c.do(http.MethodPatch, "/api/v1/auth/me", body, true)
		defer resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("patch %v = %d, want %d", body, resp.StatusCode, want)
		}
		var raw json.RawMessage
		_ = json.NewDecoder(resp.Body).Decode(&raw)
		var m me
		_ = json.Unmarshal(raw, &m)
		var e errBody
		_ = json.Unmarshal(raw, &e)
		return m, e.Error.Code
	}
	get := func() me {
		t.Helper()
		resp := c.do(http.MethodGet, "/api/v1/auth/me", nil, false)
		defer resp.Body.Close()
		var m me
		_ = json.NewDecoder(resp.Body).Decode(&m)
		return m
	}

	start := get()

	// Tab A hides a column; it lands and moves the revision on.
	a, _ := patch(map[string]any{
		"preferences":         map[string]any{"hidden": "memo"},
		"preferencesRevision": start.Revision,
	}, http.StatusOK)
	if a.Revision != start.Revision+1 || a.Preferences["hidden"] != "memo" {
		t.Fatalf("after tab A = %+v, want revision %d and the column hidden", a, start.Revision+1)
	}

	// Tab B still holds the old copy: refused, nothing written.
	if _, code := patch(map[string]any{
		"preferences":         map[string]any{"view": "index"},
		"preferencesRevision": start.Revision,
	}, http.StatusConflict); code != "stale_preferences" {
		t.Fatalf("stale save code = %q, want stale_preferences", code)
	}
	if now := get(); now.Revision != a.Revision || now.Preferences["view"] != nil || now.Preferences["hidden"] != "memo" {
		t.Fatalf("after the refused save = %+v, want tab A's save untouched", now)
	}

	// Tab B reads again and reapplies its change over tab A's.
	b, _ := patch(map[string]any{
		"preferences":         map[string]any{"hidden": "memo", "view": "index"},
		"preferencesRevision": a.Revision,
	}, http.StatusOK)
	if b.Revision != a.Revision+1 || b.Preferences["hidden"] != "memo" || b.Preferences["view"] != "index" {
		t.Fatalf("after tab B's retry = %+v, want both changes", b)
	}

	// A theme change counts as a save too; no revision means write regardless.
	th, _ := patch(map[string]any{"theme": "dark"}, http.StatusOK)
	if th.Theme != "dark" || th.Revision != b.Revision+1 || th.Preferences["view"] != "index" {
		t.Fatalf("after a theme change = %+v, want the preferences kept and the revision moved on", th)
	}
	old, _ := patch(map[string]any{"preferences": map[string]any{"legacy": true}}, http.StatusOK)
	if old.Revision != th.Revision+1 || old.Preferences["legacy"] != true {
		t.Fatalf("a save without a revision = %+v, want it written", old)
	}
}
