# CloudBank — context

**Last updated:** 2026-09-23

## Where we are

The app-wide visual restyle (#403) is **complete**. Every major surface has been rebuilt
to the style tile's measurements: register (#452), shell (#453), overview (#454), settings
(#455), motion (#456), sheets/confirmations (#436/#440), page headers and empty states
(#441), secondary pages. PR #457 (`chore/restyle-screenshots`) is open — two post-screenshot
defect fixes plus the page-title size settled at 26/700.

The design artefact is the source of truth. `docs/design/` holds the measured extraction of
every board (foundations, dark, register, overview, settings, secondary-pages, entering-
and-deciding). Build to those numbers; read the artefact canvas for the sticky notes that
the HTML export drops.

## Open issues (as of 2026-09-23)

| # | Label | Title |
|---|---|---|
| #458 | — | `check:i18n` does not detect a key missing from both locales simultaneously |
| #449 | enhancement | Restyle does not fully match the style tile on the shell |
| #447 | chore | `check:i18n` does not detect an incomplete plural form |
| #446 | enhancement | A11y: verify remaining WCAG criteria from #403 (beyond contrast) |
| #445 | chore | Clean up 46 react-hooks warnings (32 are the same anti-pattern) |
| #422 | — | Documentation refresh: accuracy pass, new screenshots, demo link |
| #421 | — | Extend the guided tutorial to every page (not just dashboard) |
| #420 | — | Demo build: throwaway users, seeded data, locked-down surface |

## In-flight branches

| Branch | Status | Notes |
|---|---|---|
| `chore/restyle-screenshots` | PR #457 open | Post-screenshot polish; 2 commits ahead of main |
| `feat/import-camt053` | local, no PR | CAMT.053 import plugin (ISO 20022); `camt.go` + tests exist |
| `fix/civil-dates-local-timezone` | local, no PR | Fixes the off-by-one date filter bug (#415) |
| `fix/windows-contributor-setup` | local, no PR | Windows build/case-collision fixes (#417) |
| `docs/pluggy-experimental-notice` | local, no PR | Pluggy marked experimental in docs |

## Backend domains

`server/internal/` packages:

- **store** — SQLite WAL, two pools (one-connection write, multi-connection read).
  Migrations are `migrations/NNNN_name.sql`, forward-only, never edited once released.
- **account, transaction, schedule, budget, goal, bill, category, currency, payee, tag,
  template, transfer** — domain services; aggregation lives in sqlc SQL, not Go.
- **importio** — import pipeline. Plugins: CSV, OFX, QIF, Intesa (Italian), CAMT.053.
  Register new plugins in `plugins.go`; the shared pipeline handles dedup, assignment rules,
  persistence.
- **banksync** — providers: Enable Banking (EU), SimpleFin (US/CA), Pluggy (LatAm, added
  in #409). Each provider has its own `<name>.go` + `<name>_service.go`.
- **ai** — AI service (client + parse + service); used for transaction categorisation.
- **httpapi** — chi router. `Options` holds one nil-able pointer per service; nil = routes
  not mounted. Tests build a minimal router via `httptest.NewServer(New(Options{...}))`.
- **wallet** — the security boundary. Every wallet-scoped route is under
  `/api/v1/wallets/{walletId}` behind `walletContext` middleware (non-member → 404).
- **secrets** — at-rest encryption when `CB_SECRET_KEY` is set.
- **config** — all configuration is `CB_*` env vars.
- **oidc, auth** — authentication.
- **backup, integrity, dbconv, exporter, report, vehicle, assetvaluation** — supporting domains.

HomeBank compatibility tracked at **v5.10.3** (`.github/homebank-version`); a scheduled
workflow opens an issue when upstream releases a newer version.

## Frontend structure

`web/src/`:

- **api/** — barrel over domain modules (`ledger.ts`, `structure.ts`, `finance.ts`, …)
  built on `core.ts`'s fetch wrapper. Same-origin cookies + `X-Requested-With` (CSRF).
- **pages/** — one file per page (`AccountsPage`, `RegisterTable`, `DashboardPage`, etc.).
  Vite builds into `server/internal/webui/dist` for `//go:embed`.
- **money.ts** — all amount parsing/formatting. Money is `int64` minor units, never float.
- **civilDate.ts** — civil dates are `YYYY-MM-DD` strings, no timezone math.
- **motion.ts** — motion primitives; `motion.test.tsx` covers them.
- **i18n/locales/** — `en.json` + `it.json` must have identical key sets;
  `npm run check:i18n` enforces parity (has two known gaps: #447, #458).
- **components/** — shared UI components.
- **onboarding/** — guided tutorial (currently dashboard only; #421 tracks expansion).

## Generated code — never hand-edit

| Artifact | Source | Command |
|---|---|---|
| `server/internal/store/db/` | `store/queries/*.sql` + migrations | `sqlc generate` |
| `web/src/api/schema.d.ts` | `api/openapi.yaml` | `npm run gen:api` |
| `server/internal/httpapi/openapi.yaml` | `api/openapi.yaml` | `cp` (in `make gen`) |

Change `api/openapi.yaml` first; run `make gen`; commit generated files in the same PR.

## Key invariants

- **Money never float.** `int64` minor units everywhere; `internal/money` (Go) and
  `src/money.ts` (web) are the only parse/format paths.
- **Transaction dates are civil dates.** `YYYY-MM-DD`, no timezone. Only audit timestamps
  are UTC RFC3339.
- **Wallet isolation.** Never query wallet-scoped data without the wallet from context;
  never add a wallet-scoped endpoint outside the `walletHandlers.routes` subtree.
- **Migrations forward-only.** Never edit a released migration file; add a new one.
- **No code from HomeBank.** Clean-room reimplementation; reference the original only for
  documented behaviour and file formats.
- **`tsc --noEmit` checks nothing.** `web/tsconfig.json` is a solution file with
  `"files": []`. Use `tsc -b` (build mode) or `npm run typecheck`.
