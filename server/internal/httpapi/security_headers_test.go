package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeadersMiddleware(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	t.Run("insecure sets core headers, no HSTS", func(t *testing.T) {
		rec := httptest.NewRecorder()
		securityHeaders(false)(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		h := rec.Header()
		if got := h.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("X-Content-Type-Options = %q", got)
		}
		if got := h.Get("X-Frame-Options"); got != "DENY" {
			t.Errorf("X-Frame-Options = %q", got)
		}
		if got := h.Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("Referrer-Policy = %q", got)
		}
		if csp := h.Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") ||
			!strings.Contains(csp, "frame-ancestors 'none'") {
			t.Errorf("SPA CSP = %q", csp)
		}
		if h.Get("Strict-Transport-Security") != "" {
			t.Errorf("HSTS must be absent without TLS")
		}
	})

	t.Run("secure adds HSTS", func(t *testing.T) {
		rec := httptest.NewRecorder()
		securityHeaders(true)(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if hsts := rec.Header().Get("Strict-Transport-Security"); !strings.HasPrefix(hsts, "max-age=") {
			t.Errorf("HSTS = %q", hsts)
		}
	})
}

// The Swagger UI page needs its own CSP that allows the CDN chrome; it must
// override the strict SPA policy.
func TestSwaggerUICSPOverride(t *testing.T) {
	rec := httptest.NewRecorder()
	// Run through the middleware first (as the real router does), then the handler.
	securityHeaders(false)(http.HandlerFunc(serveSwaggerUI)).
		ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/docs", nil))
	csp := rec.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "cdn.jsdelivr.net") {
		t.Fatalf("Swagger CSP should allow the CDN, got %q", csp)
	}
	if strings.Contains(rec.Body.String(), "swagger-ui") == false {
		t.Fatalf("swagger page not rendered")
	}
}
