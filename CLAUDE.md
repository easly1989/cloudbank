# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CloudBank is a self-hosted personal finance manager — a clean-room web port of the HomeBank
desktop app. It ships as **one Docker container**: a Go binary that embeds the built React SPA
and serves it alongside the JSON API, with SQLite on a mounted volume. No external database.

Licensed AGPL-3.0. It is a clean-room reimplementation: **never paste code from HomeBank or any
GPL/incompatible source** — the original is referenced only for documented behavior and file formats.

## Commands

Run from the repo root (see `Makefile`):

```bash
make dev        # Go backend on :8080
make web-dev    # Vite dev server on :5173, proxies /api and /healthz → :8080
make gen        # regenerate sqlc + TS API types + sync the embedded OpenAPI spec
make lint       # go vet + gofmt check, eslint + prettier
make test       # go test ./... -race, vitest
make build      # build the SPA into the Go embed dir, then the binary
make docker     # build the container image
```

Targeted runs:

```bash
cd server && go test ./internal/httpapi -run TestAccountsCreate -race -count=1
cd web && npx vitest run src/money.test.ts     # single file
cd web && npm run typecheck                    # tsc -b --noEmit (plain --noEmit checks nothing: see below)
cd web && npm run check:i18n                   # locale key parity (CI gate)
cd e2e && npm test                             # Playwright; needs the app on E2E_BASE_URL
```

Prerequisites: Go 1.26+, Node 22+, Docker. `golangci-lint` v2.1.6 runs in CI but not in `make lint`.

`make` is not available on Windows by default — `CONTRIBUTING.md` lists the direct command behind
each target. Two constraints keep a Windows checkout honest: `.gitattributes` pins line endings to
LF, and **no two source files may differ only in case** (they collide on a case-insensitive
filesystem and resolve to the wrong module, which Linux CI cannot see). `web/tsconfig.json` is a
solution file with `"files": []`, so a bare `tsc --noEmit` against it typechecks *nothing* — build
mode (`tsc -b`) is what actually checks `src/`.

## Generated code — never hand-edit

Three artifacts are generated and CI fails if they drift:

| File / dir | Generated from | By |
| --- | --- | --- |
| `server/internal/store/db/` | `internal/store/queries/*.sql` + `migrations/` | `sqlc generate` |
| `web/src/api/schema.d.ts` | `api/openapi.yaml` | `npm run gen:api` |
| `server/internal/httpapi/openapi.yaml` | `api/openapi.yaml` | `cp` (in `make gen`) |

`api/openapi.yaml` is the single source of truth for the HTTP contract. Change it first, then
run `make gen` and commit the regenerated files in the same PR.

## Architecture

**Backend (`server/`)** — a Go module in three layers:

- `internal/store` owns SQLite. It opens **two pools on the same WAL database**: a write pool
  capped at one connection (SQLite has a single writer; this serializes writes and avoids
  SQLITE_BUSY) and a multi-connection read pool. Services take `NewServiceWithRead(read, write)`
  where they have read paths, `NewService(write)` otherwise. Migrations are **forward-only**:
  `migrations/NNNN_name.sql`, applied in filename order at startup, recorded in
  `schema_migrations`, and **never edited once released** — add a new file instead.
- `internal/<domain>` (account, transaction, schedule, budget, banksync, …) — one package per
  domain, each exposing a `Service` with plain methods. Aggregation lives in SQL via sqlc, not
  in Go and not in an ORM.
- `internal/httpapi` — chi router. `Options` in `router.go` holds one nil-able pointer per
  service; a nil service simply does not mount its routes, which is how tests build a router
  with only the pieces they need (`httptest.NewServer(New(Options{...}))`).

**Wallet isolation is the security boundary.** Every wallet-scoped route is mounted under
`/api/v1/wallets/{walletId}` inside `walletHandlers.routes`, behind the `walletContext`
middleware, which checks membership and puts the `wallet.Wallet` in the request context
(`walletFromContext`). A non-member gets 404, not 403. **Never add a wallet-scoped endpoint
outside that subtree**, and never query wallet-scoped data without the wallet from context.

**Frontend (`web/`)** — React 19 + Vite + TypeScript, Mantine UI, TanStack Query/Table/Virtual,
ECharts, react-i18next, gridstack (the free-form dashboard). `src/api/client.ts` is a barrel over
domain modules (`ledger.ts`, `structure.ts`, `finance.ts`, …) built on `core.ts`'s fetch wrapper;
requests are same-origin with cookies and `X-Requested-With` (the server's CSRF check).
Vite builds **into `server/internal/webui/dist`** so `//go:embed` picks it up — a bare `go run`
without a frontend build serves a placeholder page, which is expected.

**Other top-level dirs**: `landing/` is the static one-pager deployed by hand to the separate
`easly1989.github.io` repo (this repo has no Pages site of its own); `e2e/` is Playwright against
the real container; `docs/` holds user-facing guides.

## Conventions that bite

- **Money is never a float.** Amounts are `int64` minor units in the account's currency. Parse and
  format through `internal/money` (Go) and `src/money.ts` (web).
- **Transaction dates are civil dates** — `YYYY-MM-DD` strings, no timezone math. Only audit
  timestamps are UTC RFC3339.
- **User-facing strings ship in both `en` and `it`.** `web/src/i18n/locales/*.json` must have
  identical key sets; `npm run check:i18n` enforces it.
- **Import plugins** are registered in the `plugins` slice in `server/internal/importio/plugins.go`
  — a plugin is just a `Parse([]byte) ([]Row, error)`; the shared pipeline handles duplicates,
  assignment rules and persistence. Never commit a real statement as a fixture.
- **Secrets at rest** (bank credentials, AI keys, 2FA and push keys) are encrypted via
  `internal/secrets` when `CB_SECRET_KEY` is set. Configuration is `CB_*` env vars, parsed in
  `internal/config`.

## Workflow

One issue → one branch → one PR targeting `main`. Branch prefixes `feat/ chore/ ci/ fix/ test/`;
[Conventional Commits](https://www.conventionalcommits.org/) for messages (`feat(accounts): …`).
Link the issue with `Closes #N`. CI runs lint + test + build for both stacks, a Docker smoke
build, and the Playwright e2e suite — all must be green.

`.github/homebank-version` pins the HomeBank release CloudBank tracks; a scheduled workflow opens
a compatibility issue when upstream publishes a newer one.

## Agent skills

### Issue tracker

Work is tracked as GitHub issues in `easly1989/cloudbank`, via the `gh` CLI, on the repo's
one-issue -> one-branch -> one-PR workflow. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root and ADRs under `docs/adr/`, both created lazily.
See `docs/agents/domain.md`.
