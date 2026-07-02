/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The production build is emitted into the Go server's embed directory so the
// single binary can serve the SPA. In dev, /api and /healthz are proxied to the
// Go backend on :8080.
export default defineConfig({
  plugins: [react()],
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
