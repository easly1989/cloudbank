// @ts-check
import { defineConfig } from "astro/config";

// CloudBank's marketing site is deployed to GitHub Pages as a project site at
// https://easly1989.github.io/cloudbank, so the build is served under /cloudbank.
// Override CB_SITE / CB_BASE in the workflow if the repo or owner ever changes.
export default defineConfig({
  site: process.env.CB_SITE ?? "https://easly1989.github.io",
  base: process.env.CB_BASE ?? "/cloudbank",
});
