//go:build !demo

package main

import (
	"context"
	"log/slog"

	"github.com/easly1989/cloudbank/server/internal/config"
	"github.com/easly1989/cloudbank/server/internal/httpapi"
	"github.com/easly1989/cloudbank/server/internal/store"
)

// demoBuild says this binary is the public demo. It is not: the demo is built
// with the `demo` tag (demo_on.go).
const demoBuild = false

// applyDemo does nothing outside the demo build.
func applyDemo(context.Context, config.Config, *store.Store, *httpapi.Options, *slog.Logger) (func(context.Context), error) {
	return nil, nil
}
