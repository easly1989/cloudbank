// Command cloudbank is the CloudBank server: a single binary that serves the
// JSON API and the embedded web UI.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/attachment"
	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/backup"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/category"
	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/currency"
	"github.com/easly1989/cloudbank/server/internal/dashboard"
	"github.com/easly1989/cloudbank/server/internal/httpapi"
	"github.com/easly1989/cloudbank/server/internal/importer"
	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/integrity"
	"github.com/easly1989/cloudbank/server/internal/payee"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/tag"
	"github.com/easly1989/cloudbank/server/internal/template"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
	"github.com/easly1989/cloudbank/server/internal/vehicle"
	"github.com/easly1989/cloudbank/server/internal/wallet"
)

// version is overridden at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	// `cloudbank healthcheck` performs a one-shot health probe and exits. It is
	// used by the container HEALTHCHECK, since the distroless image has no shell
	// or curl. It targets the local server using CB_ADDR.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func healthcheck() int {
	cfg := config.Load()
	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		host, port = "", "8080"
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: status", resp.StatusCode)
		return 1
	}
	return 0
}

func run() error {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLevel(cfg.LogLevel),
	}))
	slog.SetDefault(logger)
	logger.Info("starting cloudbank", "version", version, "addr", cfg.Addr, "data_dir", cfg.DataDir)

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := st.Close(); cerr != nil {
			logger.Error("closing database", "error", cerr)
		}
	}()
	logger.Info("database ready", "path", filepath.Join(cfg.DataDir, "cloudbank.db"))

	// Writes (including auth and wallets) go through the single write connection.
	authSvc := auth.NewService(db.New(st.Write()))
	walletSvc := wallet.NewService(st.Write())
	currencySvc := currency.NewService(st.Write())
	accountSvc := account.NewServiceWithRead(st.Read(), st.Write())
	categorySvc := category.NewService(st.Write())
	payeeSvc := payee.NewService(st.Write())
	transactionSvc := transaction.NewServiceWithRead(st.Read(), st.Write())
	tagSvc := tag.NewServiceWithRead(st.Read(), st.Write())
	vehicleSvc := vehicle.NewServiceWithRead(st.Read(), st.Write())
	transferSvc := transfer.NewService(st.Write())
	// The dashboard and report services are read-only (no writes), so they run on
	// the multi-connection read pool instead of the single write connection —
	// their heavy aggregation queries no longer serialize behind writers (WAL
	// allows concurrent readers).
	dashboardSvc := dashboard.NewService(st.Read())
	templateSvc := template.NewService(st.Write())
	scheduleSvc := schedule.NewService(st.Write(), transactionSvc, transferSvc, logger)
	assignmentSvc := assignment.NewService(st.Write())
	budgetSvc := budget.NewServiceWithRead(st.Read(), st.Write())
	reportSvc := report.NewService(st.Read())
	importSvc := importer.NewService(st.Write())
	csvSvc := importio.NewService(st.Write(), transactionSvc, assignmentSvc, accountSvc)
	rateProvider := &currency.Frankfurter{BaseURL: cfg.RateProviderURL}
	integritySvc := integrity.NewService(st.Write())
	backupSvc := backup.NewService(st.Write())
	attachmentSvc := attachment.NewService(st.Write(), filepath.Join(cfg.DataDir, "attachments"))
	// Remove an attachment's file when its transaction is deleted (rows cascade).
	transactionSvc.SetAttachmentPurger(attachmentSvc.PurgeTransactions)
	// Include attachment files in wallet backup/restore.
	backupSvc.SetAttachments(attachmentSvc)

	handler := httpapi.New(httpapi.Options{
		Logger:        logger,
		Health:        st,
		Auth:          authSvc,
		Wallets:       walletSvc,
		Currencies:    currencySvc,
		Accounts:      accountSvc,
		Categories:    categorySvc,
		Payees:        payeeSvc,
		Transactions:  transactionSvc,
		Tags:          tagSvc,
		Vehicles:      vehicleSvc,
		Transfers:     transferSvc,
		Dashboard:     dashboardSvc,
		Templates:     templateSvc,
		Schedules:     scheduleSvc,
		Assignments:   assignmentSvc,
		Budgets:       budgetSvc,
		Reports:       reportSvc,
		Import:        importSvc,
		CSV:           csvSvc,
		RateProvider:  rateProvider,
		Integrity:     integritySvc,
		Backup:        backupSvc,
		Attachments:   attachmentSvc,
		HotBackup:     st,
		DataDir:       cfg.DataDir,
		Version:       version,
		SecureCookies: cfg.SecureCookies,
	})

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Run the server until a termination signal arrives.
	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Post any schedules due now (startup catch-up after downtime), then keep
	// auto-posting on a ticker until shutdown.
	go runScheduler(ctx, scheduleSvc, logger)

	// Refresh online exchange rates at startup, then once a day.
	go runRateRefresh(ctx, currencySvc, rateProvider, logger)

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining connections")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

// runScheduler does a startup catch-up and then auto-posts due schedules every
// hour until the context is cancelled.
func runScheduler(ctx context.Context, svc *schedule.Service, logger *slog.Logger) {
	post := func() {
		if _, err := svc.RunDue(ctx, time.Now().UTC()); err != nil {
			logger.Error("scheduler run failed", "error", err)
		}
	}
	post()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			post()
		}
	}
}

// runRateRefresh refreshes every wallet's online exchange rates at startup and
// then once every 24 hours. Provider failures degrade gracefully (manual rates
// are kept) and are logged at warn level, never fatal.
func runRateRefresh(ctx context.Context, svc *currency.Service, provider currency.RateProvider, logger *slog.Logger) {
	refresh := func() {
		err := svc.RefreshAll(ctx, provider, func(walletID int64, res currency.RefreshResult, err error) {
			switch {
			case err != nil:
				logger.Error("rate refresh failed", "wallet", walletID, "error", err)
			case res.ProviderError != "":
				logger.Warn("rate provider unavailable, keeping manual rates",
					"wallet", walletID, "reason", res.ProviderError)
			case len(res.Updated) > 0:
				logger.Info("rates refreshed", "wallet", walletID,
					"updated", len(res.Updated), "unsupported", len(res.Unsupported), "date", res.Date)
			}
		})
		if err != nil {
			logger.Error("rate refresh job failed", "error", err)
		}
	}
	refresh()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refresh()
		}
	}
}

func parseLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
