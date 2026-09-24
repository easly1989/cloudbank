//go:build demo

package main

import (
	"context"
	"log/slog"

	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/demo"
	"github.com/easly1989/cloudbank/server/internal/httpapi"
	"github.com/easly1989/cloudbank/server/internal/store"
)

// demoBuild says this binary is the public demo.
const demoBuild = true

// applyDemo turns the server into the public demo: it refuses a data directory
// with real accounts, switches off what a throwaway account has no use for,
// keeps the bank sync to the pretend bank, and returns the job that deletes
// idle accounts and, every night, all of them.
func applyDemo(ctx context.Context, cfg config.Config, st *store.Store, opts *httpapi.Options, logger *slog.Logger) (func(context.Context), error) {
	if err := demo.Prepare(ctx, st.Write(), cfg.DataDir, cfg.Demo); err != nil {
		return nil, err
	}
	opts.Auth.SetSessionTTL(cfg.Demo.Idle)
	opts.BankSync.OnlyDemoBank()
	opts.OIDC = nil
	opts.Push = nil
	opts.AI = nil
	opts.Attachments = nil
	opts.HotBackup = nil

	svc := demo.New(cfg.Demo, st.Write(), opts.Auth, opts.Import, opts.Goals, opts.BankSync)
	opts.Demo = svc
	logger.Info("demo build: accounts are throwaway",
		"idle", cfg.Demo.Idle.String(), "max_users", cfg.Demo.MaxUsers,
		"nightly_purge_utc_hour", demo.PurgeHourUTC)
	return func(ctx context.Context) { svc.Run(ctx, logger) }, nil
}
