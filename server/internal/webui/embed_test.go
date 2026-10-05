package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHandlerCachingAndMissingFiles(t *testing.T) {
	h := handler(fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><title>shell</title>")},
		"sw.js":                {Data: []byte("// sw")},
		"manifest.webmanifest": {Data: []byte("{}")},
		"assets/index-abc.js":  {Data: []byte("export {}")},
	})

	cases := []struct {
		path, cache, body string
		status            int
	}{
		{"/", "no-cache", "shell", 200},
		{"/transactions", "no-cache", "shell", 200},
		{"/reports/vehicle", "no-cache", "shell", 200},
		{"/sw.js", "no-cache", "// sw", 200},
		{"/manifest.webmanifest", "no-cache", "{}", 200},
		{"/assets/index-abc.js", immutable, "export {}", 200},
		// A chunk of an older build: 404, not the shell (#578).
		{"/assets/VehiclesPage-old.js", "no-store", "404", 404},
		{"/favicon.ico", "no-store", "404", 404},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))
		if rec.Code != c.status {
			t.Errorf("%s: status %d, want %d", c.path, rec.Code, c.status)
		}
		if got := rec.Header().Get("Cache-Control"); got != c.cache {
			t.Errorf("%s: Cache-Control %q, want %q", c.path, got, c.cache)
		}
		if !strings.Contains(rec.Body.String(), c.body) {
			t.Errorf("%s: body %q, want it to contain %q", c.path, rec.Body.String(), c.body)
		}
	}
}
