package httpapi

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompress(t *testing.T) {
	srv := httptest.NewServer(New(Options{}))
	defer srv.Close()

	get := func(t *testing.T, path string, headers map[string]string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		// Set by hand, so the client neither adds it nor unzips the body.
		req.Header.Set("Accept-Encoding", "gzip")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}

	t.Run("the SPA's own requests are gzipped", func(t *testing.T) {
		resp := get(t, "/api/v1/ping", map[string]string{"X-Requested-With": "XMLHttpRequest"})
		if got := resp.Header.Get("Content-Encoding"); got != "gzip" {
			t.Fatalf("Content-Encoding = %q, want gzip", got)
		}
		zr, err := gzip.NewReader(resp.Body)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(zr)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), "pong") {
			t.Fatalf("body = %q, want the ping reply", body)
		}
	})

	t.Run("an API request another site could make is not", func(t *testing.T) {
		resp := get(t, "/api/v1/ping", nil)
		if got := resp.Header.Get("Content-Encoding"); got != "" {
			t.Fatalf("Content-Encoding = %q, want none", got)
		}
	})

	t.Run("a Bearer client is", func(t *testing.T) {
		resp := get(t, "/api/v1/ping", map[string]string{"Authorization": "Bearer x"})
		if got := resp.Header.Get("Content-Encoding"); got != "gzip" {
			t.Fatalf("Content-Encoding = %q, want gzip", got)
		}
	})

	t.Run("the app itself is", func(t *testing.T) {
		resp := get(t, "/", nil)
		if got := resp.Header.Get("Content-Encoding"); got != "gzip" {
			t.Fatalf("Content-Encoding = %q, want gzip", got)
		}
	})
}
