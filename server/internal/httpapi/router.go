// Package httpapi wires the HTTP router: middleware, the JSON API under
// /api/v1, the health check, and the embedded SPA.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/easly1989/cloudbank/server/internal/webui"
)

// HealthChecker reports whether a dependency (e.g. the database) is reachable.
// It is optional: the storage layer provides one in a later milestone.
type HealthChecker interface {
	Ping() error
}

// Options configures the router.
type Options struct {
	Logger *slog.Logger
	// Health, if non-nil, is pinged by /healthz. When nil, /healthz reports OK
	// as long as the process is serving.
	Health HealthChecker
}

// New builds the application's http.Handler.
func New(opts Options) http.Handler {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(requestLogger(logger))
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/healthz", healthHandler(opts.Health))

	// JSON API. Concrete resources are mounted by later milestones.
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"message": "pong"})
		})
	})

	// Everything else is the single-page app.
	r.Handle("/*", webui.Handler())

	return r
}

func healthHandler(h HealthChecker) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		if h != nil {
			if err := h.Ping(); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{
					"status": "unhealthy",
					"error":  err.Error(),
				})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// requestLogger logs one line per request at debug level.
func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			logger.Debug("http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.Status(),
				"bytes", ww.BytesWritten(),
				"duration", time.Since(start).String(),
			)
		})
	}
}
