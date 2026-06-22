# CloudBank

**CloudBank** is a free, self-hosted, web-based personal finance manager — a from-scratch web port of the excellent [HomeBank](https://www.gethomebank.org/) desktop application. It aims for feature parity with HomeBank 5.10 while being built for the browser and the cloud: a single Docker container you run yourself, with your data living in a SQLite database on a volume you control.

> Status: **1.0 — first public release.** Feature-complete against the HomeBank
> 5.10 workflow. See the [CHANGELOG](CHANGELOG.md).

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

You need [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.
Create a `docker-compose.yml` (or copy [the one in this repo](docker-compose.yml)):

```yaml
services:
  cloudbank:
    image: ghcr.io/easly1989/cloudbank:main # latest stable release (see tags below)
    container_name: cloudbank
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # Set to "false" only for a plain-HTTP LAN install without TLS in front.
      CB_SECURE_COOKIES: "false"
    volumes:
      - cloudbank-data:/data

volumes:
  cloudbank-data:
```

Then start it and open the app:

```bash
docker compose up -d
# open http://localhost:8080 and complete the first-run admin setup
```

That is the whole install — one container, no external database. Your data lives
in the `cloudbank-data` volume (a SQLite database under `/data`). Back it up by
copying that volume, or use the in-app **wallet backup** (Settings → wallet
switcher → Wallet settings) and the admin **full-database backup**.

Running behind HTTPS (recommended for anything beyond a trusted LAN)? See
[docs/reverse-proxy.md](docs/reverse-proxy.md). Coming from the HomeBank desktop
app? See [docs/migrate-from-homebank.md](docs/migrate-from-homebank.md).

## Documentation

- **API**: interactive Swagger UI is served by the app at **`/api/docs`** (the
  OpenAPI spec is at `/api/openapi.yaml`).
- **Reverse proxy / HTTPS**: [docs/reverse-proxy.md](docs/reverse-proxy.md).
- **Migrating from HomeBank**: [docs/migrate-from-homebank.md](docs/migrate-from-homebank.md).
- **Contributing / running from source**: [CONTRIBUTING.md](CONTRIBUTING.md).

### Configuration

| Env var             | Default       | Description                                              |
| ------------------- | ------------- | ------------------------------------------------------- |
| `CB_ADDR`           | `:8080`       | Address the HTTP server listens on.                     |
| `CB_DATA_DIR`       | `/data`       | Directory holding the SQLite database and backups.      |
| `CB_LOG_LEVEL`      | `info`        | `debug`, `info`, `warn`, or `error`.                    |
| `CB_SECURE_COOKIES` | `true`        | Set `false` for plain-HTTP LAN installs (no TLS).       |
| `CB_RATE_URL`       | _(frankfurter.app)_ | Override the online exchange-rate API root (e.g. a mirror). |

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

**Availability:** `:latest` is published on every push to `main` (nightly
workflow). **`:main`** and the version tags are published by the **Release**
workflow — either by publishing a GitHub Release, or by running that workflow
manually from the **Actions** tab (it has a `workflow_dispatch` trigger, with an
optional version input). If a pull fails with `unauthorized`, the GHCR package is
private: make it public (package → Settings → Change visibility) or
`docker login ghcr.io` with a token that has `read:packages`.

## License

CloudBank is licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE). If you run a modified version as a network service, the AGPL requires you to offer your modified source to its users.

## Credits

Inspired by and aiming for parity with [HomeBank](https://www.gethomebank.org/) by Maxime Doyen. CloudBank is not affiliated with or endorsed by the HomeBank project.
