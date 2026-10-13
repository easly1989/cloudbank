/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The production build is emitted into the Go server's embed directory so the
// single binary can serve the SPA. In dev, /api and /healthz are proxied to the
// Go backend on :8080.
export default defineConfig({
  // The public demo (#420) is a build of its own: CB_DEMO=1 turns on the demo's
  // screens, and a normal build folds every one of them away.
  define: {
    __DEMO__: JSON.stringify(process.env.CB_DEMO === "1"),
  },
  plugins: [
    react(),
    // Installable PWA: a web manifest plus a Workbox service worker that
    // precaches the built app shell so it loads offline. A new build waits
    // (`prompt`) until the person chooses Update in the notice main.tsx
    // registers it with: swapping it in under an open page broke it (#578).
    // The SW never serves the SPA shell
    // for /api or /healthz, and it deliberately does NOT cache API responses —
    // stale financial data is worse than an honest offline error, so the shell
    // loads offline while data still needs the network.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["logo.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        id: "/",
        name: "CloudBank",
        short_name: "CloudBank",
        description: "Self-hosted personal finance — a web port of HomeBank.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#3d86e0",
        background_color: "#ffffff",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // A language is fetched the first time it is used, not with the shell:
        // precaching would download all of them on install (#608). Once used,
        // it is kept, so the app still speaks it offline. The names carry the
        // content hash, so a kept file is never stale.
        globIgnores: ["**/locale-*.js"],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/locale-[^/]+\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "cloudbank-locales",
              expiration: { maxEntries: 20 },
            },
          },
        ],
        navigateFallback: "index.html",
        // API and health checks must reach the network, never the SPA shell.
        navigateFallbackDenylist: [/^\/api/, /^\/healthz/],
        cleanupOutdatedCaches: true,
        // Add the Web Push handlers to the generated service worker.
        importScripts: ["push-sw.js"],
      },
    }),
  ],
  build: {
    outDir: "../server/internal/webui/dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split large third-party libraries into their own long-cacheable
        // vendor chunks so the initial download is small and navigations reuse
        // cached vendor code. Pages themselves are code-split via React.lazy.
        // (Function form: the object form's type was tightened in newer Vite.)
        manualChunks(id) {
          // One chunk per translation, named so the service worker can tell
          // them apart; English stays in the bundle (src/i18n/index.ts).
          const locale = /[\\/]i18n[\\/]locales[\\/]([\w-]+)\.json$/.exec(id);
          if (locale) return locale[1] === "en" ? undefined : `locale-${locale[1]}`;
          if (!id.includes("node_modules")) return undefined;
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
              id,
            )
          )
            return "react";
          if (id.includes("@mantine")) return "mantine";
          if (id.includes("echarts") || id.includes("zrender")) return "echarts";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("@tabler")) return "icons";
          if (id.includes("@dnd-kit")) return "dndkit";
          if (id.includes("i18next")) return "i18n";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: false,
  },
});
