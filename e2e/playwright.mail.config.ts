import { defineConfig, devices } from "@playwright/test";

// Bank mails end to end (#657): a third CloudBank, with CB_SECRET_KEY and
// Microsoft pointed at the pretend one in ../server/cmd/e2e-mail. It starts
// from an empty data directory and the spec walks it from the first sign-in,
// so it runs once, in order.
export default defineConfig({
  testDir: "./mail",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  outputDir: "test-results-mail",
  use: {
    baseURL: process.env.E2E_MAIL_BASE_URL ?? "http://127.0.0.1:8082",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
