# CloudBank

**CloudBank** is a free, self-hosted, web-based personal finance manager — a from-scratch web port of the excellent [HomeBank](https://www.gethomebank.org/) desktop application. It aims for feature parity with HomeBank 5.10 while being built for the browser and the cloud: a single Docker container you run yourself, with your data living in a SQLite database on a volume you control.

> Status: **early development.** The project is being built milestone by milestone (see [the issues](https://github.com/easly1989/cloudbank/issues)). It is not yet ready for production use.

## Why

HomeBank is a fantastic GTK desktop app, but it is desktop-only. CloudBank brings the same workflow — accounts, a powerful transaction register, scheduled transactions, budgets, rich reports, and multi-format import (including native HomeBank `.xhb` import) — to a web UI you can reach from any device, while keeping the data on your own server.

CloudBank is an **independent, clean-room reimplementation**. It does not copy or link any HomeBank source code; the original is referenced only for its documented behavior and file formats. CloudBank is released under the **AGPL-3.0** (HomeBank itself is GPL-2+).

## Features (target parity)

- **Accounts** of every HomeBank type (bank, cash, checking, savings, credit card, liability, asset, investment) with per-account currency and the full set of flags.
- **Transactions** with 12 payment types, the cleared/reconciled status lifecycle, category splits, free tags, internal transfers (including cross-currency), bulk edit and duplicate detection.
- **Register** view with running balance, rich filtering, and a reconciliation workflow.
- **Scheduled transactions** with automatic posting, **templates**, and **assignment rules** for auto-categorization.
- **Budgets** and a full suite of **reports** (Statistics, Trend Time, Balance, Budget, Vehicle cost) with charts and CSV/PNG export.
- **Import**: HomeBank `.xhb`, QIF, OFX/QFX, CSV — with an import assistant. **Export**: QIF, CSV.
- **Multi-currency** with manual and online (ECB / frankfurter.app) exchange rates.
- Multi-user (admin-managed), responsive UI, light/dark theme, English and Italian.

## Quick start

> The container image is published once the foundation milestone lands. Until then, see [CONTRIBUTING.md](CONTRIBUTING.md) to run from source.

```bash
docker compose up -d
# then open http://localhost:8080 and complete the first-run admin setup
```

Your data is stored in a SQLite database under the `/data` volume. Back it up by copying that volume (or use the in-app wallet backup).

### Configuration

| Env var             | Default       | Description                                              |
| ------------------- | ------------- | ------------------------------------------------------- |
| `CB_ADDR`           | `:8080`       | Address the HTTP server listens on.                     |
| `CB_DATA_DIR`       | `/data`       | Directory holding the SQLite database and backups.      |
| `CB_LOG_LEVEL`      | `info`        | `debug`, `info`, `warn`, or `error`.                    |
| `CB_SECURE_COOKIES` | `true`        | Set `false` for plain-HTTP LAN installs (no TLS).       |

## Container images and tag convention

Images are published to **GHCR**: `ghcr.io/easly1989/cloudbank`.

> ⚠️ **Read this — the tag scheme is intentional and unconventional:**
>
> | Tag        | Meaning                                                                 |
> | ---------- | ----------------------------------------------------------------------- |
> | `:main`    | **Latest stable release** — use this for a stable self-hosted install.  |
> | `:latest`  | **Nightly build** from the `main` branch — bleeding edge, may break.     |
> | `:vX.Y.Z`  | A specific released version (e.g. `:v1.0.0`). Also `:vX.Y`.              |
>
> In other words, `:latest` is the development nightly, and `:main` is the stable release. This is the opposite of the usual Docker convention, so pin deliberately.

## License

CloudBank is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE). If you run a modified version as a network service, the AGPL requires you to offer your modified source to its users.

## Credits

Inspired by and aiming for parity with [HomeBank](https://www.gethomebank.org/) by Maxime Doyen. CloudBank is not affiliated with or endorsed by the HomeBank project.
