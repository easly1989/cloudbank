# Changelog

All notable changes to CloudBank are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Post-1.0 work focused on **personalization**, deeper **HomeBank parity & interop**,
and **onboarding/polish**.

### Added

- **Fully customizable, free-form dashboard** — place and resize widgets anywhere
  on a snap grid (not just reorder); add **multiple instances of any widget** from
  an "Add widget" palette, each with its **own settings** (e.g. two spending
  donuts over different periods); the layout persists per user and stacks to a
  single column on phones. New widget types beyond the standard set: a single
  **account balance** card, a **recent transactions** list, a **key-figure**
  big-number, and a free-text **notes** card. Existing dashboards are migrated
  automatically.
- **Per-account default payment mode** — each account can pre-fill the payment
  mode of new transactions (e.g. Direct Debit for a bank account, Credit Card for
  a card); a chosen payee's own default still takes precedence.
- **Selected-transactions total** — selecting rows in the register now shows the
  selection's net total (plus an income/expense split for mixed selections) in the
  bulk bar, HomeBank-style.
- **Scheduled income/expense summary** — the Scheduled page shows the recurring
  income, expense and net normalized **per week / month / year** at a glance.
- **HomeBank-style dashboard** — pick an account and **Add** opens the full
  transaction modal; the spending donut shows **percentages**; the income/expense
  chart is wider; and the Upcoming panel is split into **Recurring / Future /
  Reminders** tabs, each with post / skip / edit actions.
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
- **Double-click any grid row** — register, budget, currencies and the other
  management grids — to open it for editing.
- A **first-login tutorial** (coachmark tour) — dismissable, shown once per user,
  and restartable from Settings.
- **Brand logo/icon** beside the app name and as the favicon.
- A footer **donation** link (PayPal) and a **HomeBank** credit link.
- An **animated landing site** (Astro) published to GitHub Pages, now featuring
  real app screenshots and a mouse-reactive background.
- CI: a weekly **HomeBank version watch** that opens a compatibility-review issue
  when a newer HomeBank release appears.
- The **Schedules** grid now shows each scheduled transaction's **amount**.
- **Accounts** show both today's balance and a separate **projected future
  balance** (initial balance plus all dated transactions, including future ones).
- A **show / hide future transactions** toggle in the register's filter bar.
- A per-wallet setting to **pre-register scheduled transactions up to N months
  ahead** (HomeBank style, up to 3 months), used by the auto-posting scheduler.

### Changed

- The **wallet switcher** now lists only wallets + "Create wallet"; categories,
  payees, currencies, integrity, backup/restore and `.xhb` export moved under
  **Settings → Wallet**.
- **Import / export moved into Settings → Wallet** (it is wallet-scoped) and is
  no longer a separate sidebar item; the old `/import` route redirects there.
- The wallet **Settings tab is titled after the active wallet** and its sections
  (general, import, backup, danger zone) are grouped behind a section selector so
  they no longer overflow the page.
- **Settings, Import and Preferences** pages now use the full page width instead
  of a narrow centred column.
- **Dates** are rendered everywhere in the user's configured format.
- **Faster initial load** — the app is code-split per route with vendor chunks and
  imports only the chart pieces it uses, so the first download is much smaller.
- Modernized the stack (React 19, Mantine 9, Vite 8, React Router 7, current Go
  dependencies) and internal refactors (per-domain API client, dedicated
  vehicle/tag packages, a SQLite read pool for read-only queries) with no change
  in behaviour.
- Documentation now states parity with **HomeBank** (no fixed version), so it
  tracks current and future HomeBank releases.

### Fixed

- Reports: the **Statistics** pie is larger with a side legend, and the **Trend**
  and **Balance** charts render immediately instead of appearing blank until a
  control is changed.
- The **theme toggle** now switches on the **first click** (previously the first
  click was a no-op when the system theme resolved to "auto").
- **Chart legend and axis text** stay readable in both light and dark themes and
  update correctly when toggling the theme (they no longer keep stale colours).
- **Account balances** are computed from the account's transactions instead of
  always showing the initial balance (often zero).
- The dashboard **quick-add** row no longer stretches wider when a tag is added.
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
