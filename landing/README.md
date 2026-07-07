# CloudBank top-level landing (`easly1989.github.io`)

A tiny, self-contained splash page for the **root** GitHub Pages domain
`https://easly1989.github.io`, whose only jobs are:

1. give that root URL real content (AdSense won't approve a 404), and
2. send visitors to the app at `https://easly1989.github.io/cloudbank/`.

It's plain HTML/CSS/JS — **no build step**. Ads are **off by default** and load
only when you fill in your AdSense id (see below), so the page makes zero
external calls until you opt in.

## Files
- `index.html` — the landing page (animated, responsive, light/dark aware).
- `logo.svg` — the brand mark (favicon + hero). Keep in sync with the app's logo.
- `ads.txt` — AdSense authorisation file (fill in your publisher id).

## Deploy (one-time)
GitHub **user** Pages must live in a repo named exactly `easly1989.github.io`:

1. Create a **public** repo `easly1989.github.io`.
2. Copy this folder's files (`index.html`, `logo.svg`, `ads.txt`) into its root.
3. Push to `main`.
4. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`. Save.
5. Wait ~1 min, then open `https://easly1989.github.io` — it should show this page,
   and `https://easly1989.github.io/ads.txt` should serve the ads.txt.

## Turn ads on (AdSense)
Ads stay off until you set your id in **`index.html`** (top `<script>`):

```js
window.ADSENSE_CLIENT = "ca-pub-XXXXXXXXXXXXXXXX"; // your publisher id
window.ADSENSE_SLOT   = "1234567890";              // a display ad-unit slot id
```

Also put your publisher id in **`ads.txt`** (`pub-XXXXXXXXXXXXXXXX`), then redeploy.

- Leave **both** values empty to disable every ad again (no requests, no cookies).
- For approval, Google only needs the loader live — set `ADSENSE_CLIENT`, deploy,
  then submit the site for review. Create the ad unit and paste `ADSENSE_SLOT`
  once you're approved.

The same `Ad` approach is mirrored on the CloudBank site (see issue #258) so both
origins share one on/off switch pattern.
