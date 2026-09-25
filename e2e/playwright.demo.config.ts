import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

// The demo build (#420) is a different server: no setup, no login form, one
// button. Its tests live apart and run only against a demo image; see the
// e2e-demo job in .github/workflows/ci.yml.
export default defineConfig({
  ...base,
  testDir: "./demo",
});
