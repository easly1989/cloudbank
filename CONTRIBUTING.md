# Contributing to CloudBank

Thanks for your interest in CloudBank! This document describes how we work so the project stays easy to develop and hard to regress.

## Project layout

```
api/openapi.yaml          Single source of truth for the HTTP contract
server/                   Go module (backend + embedded SPA)
  cmd/cloudbank/          main entrypoint
  internal/               application packages
web/                      React + Vite + TypeScript single-page app
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

The exact branch name for each planned issue is listed in that issue's description.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, e.g. `feat(accounts): add overdraft warning`. Keep the summary in the imperative mood.

### Pull requests

- Target `main`. Keep the PR scoped to a single issue; link it with `Closes #N`.
- CI (lint + test + build for both stacks, plus a Docker smoke build) must be green.
- Update `api/openapi.yaml` and the generated types when you change the HTTP contract.
- Add or update tests. User-facing strings must ship for both `en` and `it`.

## Engineering conventions

- **Money is never a float.** Amounts are `int64` minor units in the account's currency. Parse decimal input to integers; format with locale-aware helpers.
- **Transaction dates are civil dates** (`YYYY-MM-DD` strings) — no timezone math. Only audit timestamps are UTC RFC3339.
- **Wallet isolation** is enforced in one place (membership middleware). Never query wallet-scoped data without the wallet guard.
- Prefer plain SQL (via sqlc) over an ORM; keep aggregation in SQL.

## Local development

Prerequisites: **Go 1.25+**, **Node 22+**, and Docker (for the container build).

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
make gen      # regenerate sqlc + OpenAPI types
make lint     # golangci-lint + eslint + prettier + tsc
make test     # go test + vitest
make build    # build the web app and the Go binary (embeds the SPA)
make docker   # build the container image locally
```

## License of contributions

By contributing you agree that your contributions are licensed under the project's [AGPL-3.0](LICENSE). Do **not** paste code from HomeBank or other GPL/incompatible sources — CloudBank is a clean-room reimplementation and must remain so.
