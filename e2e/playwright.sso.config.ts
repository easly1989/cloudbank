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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
