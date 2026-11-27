import { defineConfig, devices } from "@playwright/test";

// The SSO-only server (#620): a second CloudBank with CB_PASSWORD_LOGIN=false,
// signing in through the pretend provider in sso/fake-idp.mjs. It starts from
// an empty data directory, and the spec walks it from its first sign-in, so it
// runs once, in order.
export default defineConfig({
  testDir: "./sso",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  outputDir: "test-results-sso",
  use: {
    baseURL: process.env.E2E_SSO_BASE_URL ?? "http://localhost:8081",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testMatch: /sso-only/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Single sign-on set from Settings (#796): a password-login server with
    // CB_SECRET_KEY and no CB_OIDC_* variables.
    {
      name: "settings",
      testMatch: /sso-settings/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL:
          process.env.E2E_SSO_SETTINGS_BASE_URL ?? "http://localhost:8083",
      },
    },
  ],
});
