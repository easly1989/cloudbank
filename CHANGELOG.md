# Changelog

All notable changes to CloudBank are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-22

The first public release: a self-hosted, web-based personal finance manager with
HomeBank 5.10 feature parity, shipped as a single Docker container.

### Added

- **Accounts** of every HomeBank type (bank, cash, checking, savings, credit
  card, liability, asset, investment) with per-account currency and flags.
- **Transactions** with 12 payment modes, the cleared/reconciled status
  lifecycle, category **splits**, free **tags**, **internal transfers**
  (including cross-currency), bulk edit and duplicate detection.
- **Register** view with a server-computed running balance, rich combinable
  filters, and a statement **reconciliation** workflow.
- **Scheduled transactions** with automatic posting and a startup catch-up,
  reusable **templates**, and **assignment rules** for auto-categorisation.
- **Budgets** (same-every-month or twelve monthly values) and a full suite of
  **reports** — Statistics, Trend Time, Balance, Budget and Vehicle cost — with
  charts and CSV/PNG export.
- **Import**: native HomeBank `.xhb`, plus CSV (HomeBank dialect and generic
  mapped), QIF and OFX/QFX, through a shared import assistant with duplicate
  flagging, on-import rules and OFX FITID de-duplication. **Export**: CSV and QIF.
- **Multi-currency** with manual rates and online ECB rates via frankfurter.app
  (no API key), with graceful degradation to manual rates.
- **Preferences** (language, theme, date format, start screen, default account),
  a wallet **integrity check** with fixes, **wallet backup/restore** as portable
  JSON, and an admin `VACUUM INTO` hot backup of the whole database.
- **Multi-user**, admin-managed (no self-registration), with first-run setup,
  argon2id passwords, CSRF protection and login rate limiting.
- Responsive UI with light/dark themes and **English + Italian** translations.
- Interactive **API documentation** (Swagger UI) at `/api/docs`.

### Infrastructure

- Single distroless Docker image (amd64 + arm64), SQLite on a `/data` volume.
- CI (lint, race tests, build, Docker smoke, Playwright e2e) and automated GHCR
  publishing (`:latest` nightly, `:main` stable, `:vX.Y.Z` per release).

[Unreleased]: https://github.com/easly1989/cloudbank/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/easly1989/cloudbank/releases/tag/v1.0.0
