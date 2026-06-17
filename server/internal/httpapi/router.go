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

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/category"
	"github.com/easly1989/cloudbank/server/internal/currency"
	"github.com/easly1989/cloudbank/server/internal/payee"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
	"github.com/easly1989/cloudbank/server/internal/wallet"
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
	// Auth, if non-nil, mounts the authentication, setup and admin endpoints.
	Auth *auth.Service
	// Wallets, if non-nil, mounts the wallet endpoints (requires Auth).
	Wallets *wallet.Service
	// Currencies, if non-nil, mounts the currency endpoints (requires Wallets).
	Currencies *currency.Service
	// Accounts, if non-nil, mounts the account endpoints (requires Wallets).
	Accounts *account.Service
	// Categories, if non-nil, mounts the category endpoints (requires Wallets).
	Categories *category.Service
	// Payees, if non-nil, mounts the payee endpoints (requires Wallets).
	Payees *payee.Service
	// Transactions, if non-nil, mounts the transaction endpoints (requires Wallets).
	Transactions *transaction.Service
	// Transfers, if non-nil, mounts the internal-transfer endpoints (requires Wallets).
	Transfers *transfer.Service
	// SecureCookies sets the Secure flag on the session cookie.
	SecureCookies bool
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
		r.Use(csrf)
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"message": "pong"})
		})
		if opts.Auth != nil {
			ah := &authHandlers{svc: opts.Auth, secure: opts.SecureCookies}
			ah.publicRoutes(r)
			// Authenticated API: one requireAuth group shared by auth-protected
			// endpoints and the wallet endpoints.
			r.Group(func(pr chi.Router) {
				pr.Use(ah.requireAuth)
				ah.protectedRoutes(pr)
				if opts.Wallets != nil {
					(&walletHandlers{
						svc: opts.Wallets, currencies: opts.Currencies, accounts: opts.Accounts,
						categories: opts.Categories, payees: opts.Payees, transactions: opts.Transactions,
						transfers: opts.Transfers,
					}).routes(pr)
					if opts.Currencies != nil {
						pr.Get("/catalog/currencies", (&currencyHandlers{svc: opts.Currencies}).catalog)
					}
				}
			})
		}
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
