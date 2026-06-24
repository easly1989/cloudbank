# CloudBank landing site

The marketing one-pager for CloudBank, built with [Astro](https://astro.build/)
and deployed to GitHub Pages. It is **self-contained** and isolated from the app
(`web/`) and server (`server/`) builds — it has its own `package.json`.

## Develop

```bash
cd site
npm install
npm run dev      # http://localhost:4321/cloudbank
```

## Build

```bash
npm run build    # static output in site/dist
npm run preview  # serve the production build locally
```

## Deploy

Pushing to `main` with changes under `site/**` runs
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml), which builds the
site and publishes it to GitHub Pages. One-time setup: in the repository
**Settings → Pages**, set **Source = GitHub Actions**.

The site is served under `/<repo>` (e.g. `https://easly1989.github.io/cloudbank`).
The base path is configured in [`astro.config.mjs`](astro.config.mjs) and can be
overridden with the `CB_BASE` / `CB_SITE` environment variables (the workflow sets
them from the repository owner and name automatically).
