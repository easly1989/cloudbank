package webui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// The manifest's shortcuts speak the reader's language (#702).
func TestManifestShortcutsFollowTheLanguage(t *testing.T) {
	manifest := `{"name":"CloudBank","lang":"en","shortcuts":[` +
		`{"name":"New expense","url":"/transactions?new=1&kind=expense"},` +
		`{"name":"New income","url":"/transactions?new=1&kind=income"}]}`
	h := handler(fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html>")},
		"manifest.webmanifest": {Data: []byte(manifest)},
	})
	for _, c := range []struct{ accept, lang, expense, income string }{
		{"", "en", "New expense", "New income"},
		{"it-IT,it;q=0.9,en;q=0.8", "it", "Nuova spesa", "Nuova entrata"},
		{"pt-BR", "pt-BR", "Nova despesa", "Nova receita"},
		{"pt-PT,pt;q=0.9", "pt-BR", "Nova despesa", "Nova receita"},
		{"de-CH", "de", "Neue Ausgabe", "Neue Einnahme"},
		{"en-GB,it;q=0.5", "en", "New expense", "New income"},
		{"ja,fr;q=0.8", "fr", "Nouvelle dépense", "Nouveau revenu"},
		{"ja", "en", "New expense", "New income"},
	} {
		req := httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil)
		req.Header.Set("Accept-Language", c.accept)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if ct := rec.Header().Get("Content-Type"); ct != "application/manifest+json" {
			t.Errorf("%q: Content-Type %q", c.accept, ct)
		}
		if v := rec.Header().Get("Vary"); v != "Accept-Language" {
			t.Errorf("%q: Vary %q", c.accept, v)
		}
		var m struct {
			Lang      string `json:"lang"`
			Shortcuts []struct{ Name string }
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
			t.Fatalf("%q: %v (%s)", c.accept, err, rec.Body)
		}
		if m.Lang != c.lang || len(m.Shortcuts) != 2 || m.Shortcuts[0].Name != c.expense || m.Shortcuts[1].Name != c.income {
			t.Errorf("%q: got %+v, want %s %q %q", c.accept, m, c.lang, c.expense, c.income)
		}
	}
}
