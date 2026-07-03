package httpapi

import "net/http"

// spaCSP is the Content-Security-Policy for the single-page app. The production
// build loads only same-origin hashed module scripts and stylesheets — there
// are no inline <script> blocks — so 'self' is enough for scripts. Mantine
// injects <style> tags at runtime, hence 'unsafe-inline' for styles only.
// Charts and the logo use data:/blob: images; every network call is same-origin.
const spaCSP = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self' data:; " +
	"connect-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'"

// securityHeaders sets defensive response headers on every request. It applies
// the strict SPA CSP by default; handlers that serve different content (the
// Swagger UI page, attachment downloads) override Content-Security-Policy with
// their own policy. secure adds HSTS, which is only meaningful behind TLS — the
// same condition the Secure cookie flag is gated on.
func securityHeaders(secure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Content-Security-Policy", spaCSP)
			if secure {
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}
