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
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          mantine: ["@mantine/core", "@mantine/hooks", "@mantine/notifications"],
          echarts: ["echarts"],
          tanstack: ["@tanstack/react-query", "@tanstack/react-table", "@tanstack/react-virtual"],
          icons: ["@tabler/icons-react"],
          dndkit: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          i18n: ["i18next", "react-i18next", "i18next-browser-languagedetector"],
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
