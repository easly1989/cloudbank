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
	"github.com/easly1989/cloudbank/server/internal/auth"
	"github.com/easly1989/cloudbank/server/internal/budget"
	"github.com/easly1989/cloudbank/server/internal/category"
	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/currency"
	"github.com/easly1989/cloudbank/server/internal/dashboard"
	"github.com/easly1989/cloudbank/server/internal/httpapi"
	"github.com/easly1989/cloudbank/server/internal/payee"
	"github.com/easly1989/cloudbank/server/internal/report"
	"github.com/easly1989/cloudbank/server/internal/schedule"
	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/template"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
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
	accountSvc := account.NewService(st.Write())
	categorySvc := category.NewService(st.Write())
	payeeSvc := payee.NewService(st.Write())
	transactionSvc := transaction.NewService(st.Write())
	transferSvc := transfer.NewService(st.Write())
	dashboardSvc := dashboard.NewService(st.Write())
	templateSvc := template.NewService(st.Write())
	scheduleSvc := schedule.NewService(st.Write(), transactionSvc, transferSvc, logger)
	assignmentSvc := assignment.NewService(st.Write())
	budgetSvc := budget.NewService(st.Write())
	reportSvc := report.NewService(st.Write())

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
		Transfers:     transferSvc,
		Dashboard:     dashboardSvc,
		Templates:     templateSvc,
		Schedules:     scheduleSvc,
		Assignments:   assignmentSvc,
		Budgets:       budgetSvc,
		Reports:       reportSvc,
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
