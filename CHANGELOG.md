# Changelog

All notable changes to CloudBank are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Post-1.0 work focused on **personalization**, deeper **HomeBank parity & interop**,
and **onboarding/polish**.

### Added

- **Customizable dashboard** — drag to reorder widgets, resize them (full / half /
  third width) and show or hide them; the layout persists per user.
- **Themes** — an **accent-colour picker** alongside light / dark / auto; the
  light/dark toggle now persists as a user setting (survives a refresh).
- **Collapsible sidebar** (icon rail) and **pinnable, reorderable navigation**
  with a "More" group for unpinned items.
- **Templates** — a dedicated management page (create/edit/delete), and templates
  are offered when entering a transaction instead of appearing as "upcoming".
- **HomeBank `.xhb` export** — download a wallet back to a HomeBank file
  (round-trips with the importer); available from the wallet's backup section.
- **Desktop-style income/expense chart** on the dashboard (diverging bars around
  a zero line) with a selectable period.
- **Smart amount entry** (HomeBank style) — `12.40` and `12,40` are both read as
  decimals; a per-user preference, on by default.
- **Double-click a register row** to open it for editing.
- A **first-login tutorial** (coachmark tour) — dismissable, shown once per user,
  and restartable from Settings.
- **Brand logo/icon** beside the app name and as the favicon.
- A footer **donation** link (PayPal) and a **HomeBank** credit link.
- **Quick-add** a transaction from the dashboard, with a richer Upcoming panel.
- An **animated landing site** (Astro) published to GitHub Pages.
- CI: a weekly **HomeBank version watch** that opens a compatibility-review issue
  when a newer HomeBank release appears.

### Changed

- The **wallet switcher** now lists only wallets + "Create wallet"; categories,
  payees, currencies, integrity, backup/restore and `.xhb` export moved under
  **Settings → Wallet**.
- **Dates** are rendered everywhere in the user's configured format.
- Documentation now states parity with **HomeBank** (no fixed version), so it
  tracks current and future HomeBank releases.

### Fixed

- Reports: the **Statistics** pie is larger with a side legend, and the **Trend**
  and **Balance** charts render immediately instead of appearing blank until a
  control is changed.
- Italian status labels aligned with the HomeBank desktop wording.

## [1.0.0] - 2026-06-22

The first public release: a self-hosted, web-based personal finance manager with
HomeBank feature parity, shipped as a single Docker container.

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
