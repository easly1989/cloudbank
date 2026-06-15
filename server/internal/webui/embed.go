// Package webui embeds the built React single-page application and serves it,
// with an index.html fallback for client-side routes.
package webui

import (
	"bytes"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// dist holds the production build of the web app. It is populated by the web
// build (Vite outputs into this directory) before `go build` runs. When the
// frontend has not been built, only the .gitkeep placeholder is present and
// Handler serves a friendly notice instead.
//
//go:embed all:dist
var dist embed.FS

// placeholder is served when no built SPA is embedded (e.g. a bare `go run`
// without first building the frontend).
const placeholder = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>CloudBank</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>CloudBank</h1>
<p>The backend is running, but the web frontend has not been built into this binary.</p>
<p>Run <code>make build</code> (or build the <code>web/</code> app and re-run <code>go build</code>)
to embed the SPA. The JSON API is available under <code>/api</code> and the health check at
<code>/healthz</code>.</p>
</body></html>`

// Handler returns an http.Handler serving the embedded SPA. Requests for
// existing static assets are served directly; any other path falls back to
// index.html so the client-side router can handle it.
func Handler() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return placeholderHandler()
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return placeholderHandler()
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if upath == "" {
			upath = "index.html"
		}
		if _, err := fs.Stat(sub, upath); err != nil {
			// Not a real asset: hand off to the SPA entry point.
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func placeholderHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.Copy(w, bytes.NewReader([]byte(placeholder)))
	})
}
