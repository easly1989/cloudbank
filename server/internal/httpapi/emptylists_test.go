package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type listItem struct {
	Name string   `json:"name"`
	Tags []string `json:"tags"`
}

type listPage struct {
	Items  []listItem       `json:"items"`
	Extra  []string         `json:"extra,omitempty"`
	Counts map[string]int   `json:"counts"`
	Next   *listItem        `json:"next"`
	When   time.Time        `json:"when"`
	Raw    json.RawMessage  `json:"raw"`
	Bytes  []byte           `json:"bytes"`
	Any    any              `json:"any"`
	ByName map[string][]int `json:"byName"`
	Pair   [2][]string      `json:"pair"`
	Hidden []string         `json:"-"`
}

func encodeJSON(t *testing.T, v any) string {
	t.Helper()
	rec := httptest.NewRecorder()
	writeJSON(rec, 200, v)
	return strings.TrimSpace(rec.Body.String())
}

func TestWriteJSONSendsEmptyListsNotNull(t *testing.T) {
	cases := []struct {
		name string
		v    any
		want string
	}{
		{"top-level slice", []string(nil), `[]`},
		{"top-level map", map[string]int(nil), `{}`},
		{"nil value", nil, `null`},
		{"slice in a struct in a slice", []listItem{{Name: "a"}, {Name: "b", Tags: []string{"x"}}},
			`[{"name":"a","tags":[]},{"name":"b","tags":["x"]}]`},
		{"behind a pointer", &listItem{Name: "a"}, `{"name":"a","tags":[]}`},
		{"inside an interface", map[string]any{"rows": []int(nil)}, `{"rows":[]}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := encodeJSON(t, c.v); got != c.want {
				t.Fatalf("got %s, want %s", got, c.want)
			}
		})
	}
}

func TestWriteJSONLeavesTheRestAlone(t *testing.T) {
	when := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	page := listPage{
		Items:  []listItem{{Name: "a"}},
		When:   when,
		ByName: map[string][]int{"k": nil},
		Hidden: nil,
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(encodeJSON(t, page)), &got); err != nil {
		t.Fatal(err)
	}

	// Filled: lists and maps the contract promises.
	for key, want := range map[string]string{
		"items":  `[{"name":"a","tags":[]}]`,
		"counts": `{}`,
		"byName": `{"k":[]}`,
		"pair":   `[[],[]]`,
	} {
		b, _ := json.Marshal(got[key])
		if string(b) != want {
			t.Errorf("%s = %s, want %s", key, b, want)
		}
	}
	// Untouched: absent values, and types that encode themselves.
	for _, key := range []string{"next", "raw", "bytes", "any"} {
		if got[key] != nil {
			t.Errorf("%s = %v, want null", key, got[key])
		}
	}
	if got["when"] != when.Format(time.RFC3339) {
		t.Errorf("when = %v", got["when"])
	}
	for _, key := range []string{"extra", "Hidden"} {
		if _, ok := got[key]; ok {
			t.Errorf("%s is present, want omitted", key)
		}
	}
	// The caller's value is not modified.
	if page.Items[0].Tags != nil || page.ByName["k"] != nil {
		t.Error("writeJSON modified the value it was given")
	}
}

func TestWriteJSONKeepsFilledValuesAsTheyAre(t *testing.T) {
	v := []listItem{{Name: "a", Tags: []string{"x"}}}
	if emptyLists(v) == nil {
		t.Fatal("lost the value")
	}
	if got := encodeJSON(t, v); got != `[{"name":"a","tags":["x"]}]` {
		t.Fatalf("got %s", got)
	}
}
