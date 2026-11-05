# Maintainer notes: commands, architecture, design spec

Moved from CLAUDE.md. Read the section that matches the task.

## Targeted commands and Windows notes

```bash
cd server && go test ./internal/httpapi -run TestAccountsCreate -race -count=1
cd web && npx vitest run src/money.test.ts     # single file
cd web && npm run typecheck                    # tsc -b --noEmit (plain --noEmit checks nothing: see below)
cd web && npm run check:i18n                   # locale parity, plurals, placeholders (CI gate)
cd web && npm run check:glossary               # warns where a translation drifts from docs/i18n/glossary.md
cd e2e && npm test                             # Playwright; needs the app on E2E_BASE_URL
cd e2e && npm run test:i18n                    # every page in every language; needs a demo build on E2E_BASE_URL
cd e2e && npm run test:mail                    # bank mails end to end against a pretend Microsoft (see docker-compose.ci.yml)
```

Prerequisites: Go 1.27.3+, Node 22+ (CI and the image use 26), Docker. `golangci-lint` v2.14.0 runs in CI but not in `make lint`.

`make` is not available on Windows by default — `CONTRIBUTING.md` lists the direct command behind
each target. Two constraints keep a Windows checkout honest: `.gitattributes` pins line endings to
LF, and **no two source files may differ only in case** (they collide on a case-insensitive
filesystem and resolve to the wrong module, which Linux CI cannot see). `web/tsconfig.json` is a
solution file with `"files": []`, so a bare `tsc --noEmit` against it typechecks *nothing* — build
mode (`tsc -b`) is what actually checks `src/`.

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


**Frontend (`web/`)** — React 19 + Vite + TypeScript, Mantine UI, TanStack Query/Table/Virtual,
ECharts, react-i18next, gridstack (the free-form dashboard). `src/api/client.ts` is a barrel over
domain modules (`ledger.ts`, `structure.ts`, `finance.ts`, …) built on `core.ts`'s fetch wrapper;
requests are same-origin with cookies and `X-Requested-With` (the server's CSRF check).
Vite builds **into `server/internal/webui/dist`** so `//go:embed` picks it up — a bare `go run`
without a frontend build serves a placeholder page, which is expected.

**Other top-level dirs**: `e2e/` is Playwright against the real container, plus the audits and
`screenshots.mjs`; `docs/` holds user-facing guides, except `docs/research/`: maintainers' notes
on what was investigated or measured before a technical decision (start there before re-opening
one), with the scripts that produced the numbers. The website lives in the separate
`easly1989.github.io` repo (this repo has no Pages site of its own). It reads the published
versions from `versions.json` on this repo's `site-data` branch, which `release.yml` and
`docker-nightly.yml` rewrite on every publish.

**The demo build** (`:demo`) is the same app compiled with the Go tag `demo` and Vite's
`__DEMO__` (`CB_DEMO=1`): `internal/demo` makes throwaway accounts with seeded data and purges
them. `docs/demo.md` describes it for visitors — change the two together.

## The design spec is the target

The UI is built against a design artefact — the **"CloudBank restyle — style tile"** Artifact,
whose boards cover foundations, dark, the register, the overview, settings, the secondary pages
and the entry sheet. `docs/design/` holds the measured extraction of each board: every element
with its text, position, size, weight, colour and spacing.

**Build to those numbers and verify by measuring the result.** Do not approximate the design from
a screenshot, and do not nudge an existing page "towards" it one increment at a time — that
produces something that looks vaguely right and is wrong everywhere. If a page cannot reach the
design by editing, rebuild it.

Two things that are easy to miss:

- **Read the artefact, not an export of it.** The canvas notes — the yellow stickies — carry the
  reasoning, and the HTML export drops them. The note that says where the settings gear goes
  exists only in the artefact's `canvas.json`.
- **When the app has something the design does not**, say so and ask. Quietly keeping it because
  removing it feels risky is how the two drift apart.
