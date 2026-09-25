# Contributing to CloudBank

Thanks for your interest in CloudBank! This document describes how we work so the project stays easy to develop and hard to regress.

## Project layout

```
api/openapi.yaml          Single source of truth for the HTTP contract
server/                   Go module (backend + embedded SPA)
  cmd/cloudbank/          main entrypoint
  internal/               application packages
web/                      React + Vite + TypeScript single-page app
e2e/                      Playwright suite, plus the audits and the screenshot script
docs/                     User guides; docs/design/ holds the measured design boards
.github/workflows/        CI/CD pipelines
Dockerfile                Multi-stage build → single container
docker-compose.yml        Local run example
```

## Workflow: one issue → one branch → one PR

Every change is tracked by a GitHub issue and developed on its **own branch**, then merged via a **single pull request**.

### Branch naming

Use a type prefix matching the issue:

| Prefix    | For                                            | Example                       |
| --------- | ---------------------------------------------- | ----------------------------- |
| `feat/`   | New features                                   | `feat/accounts-crud`          |
| `chore/`  | Tooling, docs, repo housekeeping               | `chore/repo-bootstrap`        |
| `ci/`     | CI/CD pipelines                                | `ci/pipeline`                 |
| `fix/`    | Bug fixes                                      | `fix/running-balance-order`   |
| `test/`   | Test-only changes                              | `test/e2e-playwright`         |


### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, e.g. `feat(accounts): add overdraft warning`. Keep the summary in the imperative mood.

### Pull requests

- Target `main`. Keep the PR scoped to a single issue; link it with `Closes #N`.
- CI must be green: lint + test + build for both stacks, a Docker smoke build, and
  the Playwright suite against both the ordinary and the `:demo` build.
- Update `api/openapi.yaml` and the generated types when you change the HTTP contract.
- Add or update tests. User-facing strings must ship for both `en` and `it`, with
  identical key sets (`cd web && npm run check:i18n`).

## Engineering conventions

- **Money is never a float.** Amounts are `int64` minor units in the account's currency. Parse decimal input to integers; format with locale-aware helpers.
- **Transaction dates are civil dates** (`YYYY-MM-DD` strings) — no timezone math. Only audit timestamps are UTC RFC3339.
- **Wallet isolation** is enforced in one place (membership middleware). Never query wallet-scoped data without the wallet guard.
- Prefer plain SQL (via sqlc) over an ORM; keep aggregation in SQL.

## Contributing a bank import plugin

Adding support for a bank's statement export is a great first contribution — a
plugin is just a parser, and the shared pipeline does the rest. See
[docs/import-plugins.md](docs/import-plugins.md) for the `ImportPlugin`/`Row`
contract, a worked example, and testing guidance. Please don't commit a real
personal statement as a fixture — redact it to a couple of fabricated rows.

## Local development

Prerequisites: **Go 1.26+**, **Node 22+**, and Docker (for the container build).

```bash
# Backend
cd server
go run ./cmd/cloudbank        # serves on :8080

# Frontend (separate terminal)
cd web
npm install
npm run dev                   # Vite dev server, proxies /api → :8080
```

Common tasks are wrapped in the `Makefile`:

```bash
make gen      # regenerate sqlc + OpenAPI types, and copy the spec the server embeds
make lint     # go vet + gofmt, eslint + prettier (CI also runs golangci-lint)
make test     # go test + vitest
make build    # build the web app and the Go binary (embeds the SPA)
make docker   # build the container image locally
```

### Checking colour contrast

The UI is meant to meet WCAG AA in **both** the light and the dark theme, which
is not something you can settle by looking at it. `e2e/contrast-audit.mjs`
measures it: it walks every page in both schemes, works out the colour actually
painted behind each piece of text, and reports anything under 4.5:1 (3:1 for
large text). Run it against a built binary, not the Vite dev server:

```bash
CB_BASE_URL=http://localhost:8080 node contrast-audit.mjs
```

It exits non-zero if anything fails, and lists separately the text sitting on a
gradient — there is no single background colour to measure there, so those are
checked by hand. Disabled controls are skipped: WCAG exempts them.

**It needs data to measure.** It can only measure what renders, and an empty
wallet hides every badge, amount and row — a bare instance reports clean while a
seeded one finds real failures. So the audit imports `e2e/fixtures/sample.xhb`
into a wallet of its own the first time it runs.

Change a colour and it is worth a run, especially a token in `web/src/app.css`
or anything passed as `c=` on a `Text`.

### Retaking the documentation screenshots

`e2e/screenshots.mjs` retakes every image in `docs/img`. Run it against a fresh
ordinary build; point `CB_DEMO_URL` at a running `:demo` build too, and it
copies the demo's year of made-up data in through a wallet backup first:

```bash
CB_BASE_URL=http://localhost:8080 CB_DEMO_URL=http://localhost:8081 node screenshots.mjs
```

Without `CB_DEMO_URL` it imports the much smaller sample file instead.

### Working on Windows

Everything here works on Windows — the repo is developed on it — but `make` is
**not** part of a default Windows install (not even alongside Git Bash), and the
recipes use `cp`, `rm -rf` and `find`, which need a POSIX shell. Either install
`make` plus Git Bash and use the targets above, or run the underlying commands
directly. Each target is only a line or two:

| Instead of | Run |
| --- | --- |
| `make dev` | `cd server && go run ./cmd/cloudbank` |
| `make web-dev` | `cd web && npm run dev` |
| `make lint` | `cd server && go vet ./...` then `cd web && npm run lint` |
| `make test` | `cd server && go test ./... -race -count=1` then `cd web && npm run test` |
| `make build` | `cd web && npm run build` then `cd server && go build ./cmd/cloudbank` |

`make gen` is the one worth spelling out, because of the copy at the end:

```powershell
cd server; sqlc generate
cd ..\web; npm run gen:api
Copy-Item ..\api\openapi.yaml ..\server\internal\httpapi\openapi.yaml
```

Two things the repo does so a Windows checkout behaves like a Linux one:

- **`.gitattributes` pins line endings to LF.** Without it, a clone with the
  common `core.autocrlf=true` gets CRLF and `prettier --check` fails on files you
  never touched. If you cloned before that file existed, run
  `git add --renormalize .` once.
- **No two source files may differ only in case.** On a case-insensitive
  filesystem they collide and the build resolves imports to the wrong one, which
  Linux CI cannot see. This is why the register's filter model is
  `registerFilterModel.ts` rather than sharing a name with `RegisterFilters.tsx`.

## License of contributions

By contributing you agree that your contributions are licensed under the project's [AGPL-3.0](LICENSE). Do **not** paste code from HomeBank or other GPL/incompatible sources — CloudBank is a clean-room reimplementation and must remain so.
