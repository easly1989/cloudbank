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

Targeted runs (single Go test, vitest file, `npm run typecheck`, i18n checks, Playwright) and the Windows notes (no `make`; use `tsc -b`, never bare `tsc --noEmit`; no two files differing only in case): [docs/maintainer-notes.md](docs/maintainer-notes.md).

Prerequisites: Go 1.27.3+, Node 22+ (CI and the image use 26), Docker. `golangci-lint` v2.14.0 runs in CI but not in `make lint`. `npm run check:i18n` is a CI gate.

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

- `internal/store`: SQLite, a one-connection write pool plus a read pool on the same WAL database. Migrations are
  **forward-only** (`migrations/NNNN_name.sql`) and **never edited once released**: add a new file.
- `internal/<domain>`: one package per domain with a `Service`; aggregation lives in SQL via sqlc, not Go or an ORM.
- `internal/httpapi`: chi router; a nil service in `Options` does not mount its routes.

**Wallet isolation is the security boundary.** Every wallet-scoped route is mounted under
`/api/v1/wallets/{walletId}` inside `walletHandlers.routes`, behind the `walletContext`
middleware, which checks membership and puts the `wallet.Wallet` in the request context
(`walletFromContext`). A non-member gets 404, not 403. **Never add a wallet-scoped endpoint
outside that subtree**, and never query wallet-scoped data without the wallet from context.


**Frontend (`web/`)**: React 19 + Vite + TypeScript, built into `server/internal/webui/dist` (a bare `go run` without a build
serves a placeholder, which is expected). Other dirs: `e2e/` Playwright, `docs/` guides (`docs/research/`: read before
re-opening a technical decision), `docs/demo.md` describes the `:demo` build (change both together). Full architecture:
[docs/maintainer-notes.md](docs/maintainer-notes.md).

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

## The design spec is the target

Build the UI to the design numbers in `docs/design/` and verify by measuring the result; never approximate from a
screenshot or nudge a page towards it. When the app has something the design does not, say so and ask. Read the
Artifact's `canvas.json` notes, not an HTML export. Full rules: [docs/maintainer-notes.md](docs/maintainer-notes.md).

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

### Token tools

CBM: call `index_repository` once, then `search_graph` / `trace_path` before reading files.
