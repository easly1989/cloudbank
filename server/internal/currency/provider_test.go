package currency

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFrankfurterLatest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/latest" || r.URL.Query().Get("from") != "EUR" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"amount":1.0,"base":"EUR","date":"2026-06-18","rates":{"USD":1.07,"GBP":0.84}}`))
	}))
	defer srv.Close()

	f := &Frankfurter{BaseURL: srv.URL}
	rates, date, err := f.Latest(context.Background(), "EUR")
	if err != nil {
		t.Fatalf("Latest: %v", err)
	}
	if date != "2026-06-18" || rates["USD"] != 1.07 || rates["GBP"] != 0.84 {
		t.Fatalf("rates = %v, date = %q", rates, date)
	}
}

func TestFrankfurterUnsupportedBaseErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()

	f := &Frankfurter{BaseURL: srv.URL}
	if _, _, err := f.Latest(context.Background(), "XYZ"); err == nil {
		t.Fatalf("expected an error for a non-200 response")
	}
}
