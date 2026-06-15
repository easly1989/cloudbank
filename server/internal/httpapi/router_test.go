package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthzOK(t *testing.T) {
	srv := httptest.NewServer(New(Options{}))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

type failingHealth struct{}

func (failingHealth) Ping() error { return errors.New("db down") }

func TestHealthzUnhealthy(t *testing.T) {
	srv := httptest.NewServer(New(Options{Health: failingHealth{}}))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.StatusCode)
	}
}

func TestSPAFallback(t *testing.T) {
	srv := httptest.NewServer(New(Options{}))
	defer srv.Close()

	// An unknown client-side route should still return 200 (placeholder or SPA).
	resp, err := http.Get(srv.URL + "/some/client/route")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}
