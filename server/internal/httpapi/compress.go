package httpapi

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
)

// compressibleTypes are the text responses worth gzipping: the SPA's assets,
// the JSON API and the exports. Images, attachments and backups are left alone.
var compressibleTypes = []string{
	"text/html", "text/css", "text/plain", "text/javascript", "text/csv",
	"application/javascript", "application/json", "application/manifest+json",
	"application/qif", "application/yaml", "image/svg+xml",
}

// compress gzips text responses for clients that accept it (#541); a large
// register shrinks about seven times.
//
// JSON API responses are compressed only for requests a cross-site page cannot
// make: ones carrying X-Requested-With (the SPA always sends it) or a Bearer
// token. A navigation from another site can still carry the SameSite=Lax
// session cookie, and a compressed response to it could leak its contents
// through its size (BREACH). The SPA's own assets hold nothing secret, so they
// are always compressed.
func compress(next http.Handler) http.Handler {
	gz := middleware.Compress(5, compressibleTypes...)(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/") &&
			r.Header.Get("X-Requested-With") == "" && bearerToken(r) == "" {
			next.ServeHTTP(w, r)
			return
		}
		gz.ServeHTTP(w, r)
	})
}
