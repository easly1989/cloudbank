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
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/attachment"
	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/backup"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/category"
	"github.com/easly1989/cloudbank/server/internal/currency"
	"github.com/easly1989/cloudbank/server/internal/dashboard"
	"github.com/easly1989/cloudbank/server/internal/importer"
	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/integrity"
	"github.com/easly1989/cloudbank/server/internal/payee"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/tag"
	"github.com/easly1989/cloudbank/server/internal/template"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
	"github.com/easly1989/cloudbank/server/internal/vehicle"
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
	// RateProvider, if non-nil, enables the "refresh rates" endpoint and the
	// daily background refresh (online exchange rates).
	RateProvider currency.RateProvider
	// Accounts, if non-nil, mounts the account endpoints (requires Wallets).
	Accounts *account.Service
	// Categories, if non-nil, mounts the category endpoints (requires Wallets).
	Categories *category.Service
	// Payees, if non-nil, mounts the payee endpoints (requires Wallets).
	Payees *payee.Service
	// Transactions, if non-nil, mounts the transaction endpoints (requires Wallets).
	Transactions *transaction.Service
	// Tags, if non-nil, mounts the tag-management endpoints (requires Wallets).
	Tags *tag.Service
	// Vehicles, if non-nil, mounts the vehicle endpoints (requires Wallets).
	Vehicles *vehicle.Service
	// Transfers, if non-nil, mounts the internal-transfer endpoints (requires Wallets).
	Transfers *transfer.Service
	// Dashboard, if non-nil, mounts the dashboard endpoint (requires Wallets).
	Dashboard *dashboard.Service
	// Templates, if non-nil, mounts the template endpoints (requires Wallets).
	Templates *template.Service
	// Schedules, if non-nil, mounts the schedule endpoints (requires Wallets).
	Schedules *schedule.Service
	// Assignments, if non-nil, mounts the assignment-rule endpoints (requires Wallets).
	Assignments *assignment.Service
	// Budgets, if non-nil, mounts the budget endpoints (requires Wallets).
	Budgets *budget.Service
	// Reports, if non-nil, mounts the report endpoints (requires Wallets).
	Reports *report.Service
	// Import, if non-nil, mounts the file-import endpoints (requires Auth).
	Import *importer.Service
	// Integrity, if non-nil, mounts the wallet anomaly-check endpoints (requires Wallets).
	Integrity *integrity.Service
	// Backup, if non-nil, mounts the wallet JSON backup/restore endpoints (requires Auth).
	Backup *backup.Service
	// Attachments, if non-nil, mounts the transaction file-attachment endpoints
	// (requires Wallets).
	Attachments *attachment.Service
	// HotBackup, if non-nil, mounts the admin VACUUM hot-backup endpoint.
	HotBackup HotBackuper
	// DataDir is the writable directory used to stage hot backups.
	DataDir string
	// CSV, if non-nil, mounts the CSV/QIF/OFX import and CSV/QIF export endpoints
	// (requires Wallets).
	CSV *importio.Service
	// SecureCookies sets the Secure flag on the session cookie.
	SecureCookies bool
	// Version is the running build version, surfaced at GET /api/v1/version.
	Version string
}

// New builds the application's http.Handler.
func New(opts Options) http.Handler {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	// Note: chi's RealIP is intentionally NOT used — it trusts client-supplied
	// X-Forwarded-For / X-Real-IP headers, which are spoofable (GHSA-3fxj-...),
	// so it would let an attacker bypass the login rate limiter or frame another
	// IP. The rate limiter keys on the real TCP peer (r.RemoteAddr) instead.
	r.Use(requestLogger(logger))
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders(opts.SecureCookies))
	r.Use(middleware.Timeout(60 * time.Second))

	r.Get("/healthz", healthHandler(opts.Health))

	// Public API documentation: the embedded OpenAPI spec and Swagger UI.
	r.Get("/api/openapi.yaml", serveOpenAPISpec)
	r.Get("/api/docs", serveSwaggerUI)

	version := opts.Version
	if version == "" {
		version = "dev"
	}

	// JSON API. Concrete resources are mounted by later milestones.
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(csrf)
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"message": "pong"})
		})
		r.Get("/version", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"version": version})
		})
		if opts.Auth != nil {
			ah := &authHandlers{svc: opts.Auth, secure: opts.SecureCookies}
			ah.publicRoutes(r)
			// Authenticated API: one requireAuth group shared by auth-protected
			// endpoints and the wallet endpoints.
			r.Group(func(pr chi.Router) {
				pr.Use(ah.requireAuth)
				ah.protectedRoutes(pr)
				if opts.Import != nil {
					pr.Post("/import/xhb", (&importHandlers{svc: opts.Import}).xhb)
				}
				if opts.Backup != nil {
					pr.Post("/backup/restore", (&backupHandlers{svc: opts.Backup}).restore)
				}
				if opts.HotBackup != nil {
					pr.With(ah.requireAdmin).Get("/admin/backup",
						(&backupHandlers{hot: opts.HotBackup, dataDir: opts.DataDir}).hotBackup)
				}
				if opts.Wallets != nil {
					(&walletHandlers{
						svc: opts.Wallets, currencies: opts.Currencies, accounts: opts.Accounts,
						categories: opts.Categories, payees: opts.Payees, transactions: opts.Transactions,
						tags: opts.Tags, vehicles: opts.Vehicles,
						transfers: opts.Transfers, dashboard: opts.Dashboard, templates: opts.Templates,
						schedules: opts.Schedules, assignments: opts.Assignments, budgets: opts.Budgets,
						reports: opts.Reports, csv: opts.CSV, rateProvider: opts.RateProvider,
						integrity: opts.Integrity, backup: opts.Backup, attachments: opts.Attachments,
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
