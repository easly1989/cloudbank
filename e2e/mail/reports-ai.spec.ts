import { expect, test, type Page } from "@playwright/test";

// The AI's monthly report (#696) on the real server, written by the pretend AI
// provider in ../server/cmd/e2e-mail: switched on in the settings, the page
// appears in the sidebar, "Generate now" writes last month's report into the
// AI box, and the box's colours flow unless the reader or the system says no.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
const MEMO = "a private note for nobody";

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

async function setAI(page: Page, extra: Record<string, unknown>) {
  const res = await page.request.put("/api/v1/ai/settings", {
    headers: H,
    data: {
      enabled: true,
      baseUrl: `${FAKE}/v1`,
      model: "pretend",
      features: { suggest: false, entry: false, mail: true, reports: true },
      ...extra,
    },
  });
  expect(res.ok()).toBe(true);
}

const report = (page: Page) => page.getByRole("region", { name: "AI report" });
const animation = (page: Page) =>
  report(page).evaluate((el) => getComputedStyle(el).animationName);

test("Generate now writes last month's report in the AI box", async ({
  page,
}) => {
  await signIn(page);
  await setAI(page, { motion: true });

  // Last month's money, on the account the bank-mail specs created.
  const [wallet] = (await (
    await page.request.get("/api/v1/wallets", { headers: H })
  ).json()) as { id: number }[];
  const accounts = (await (
    await page.request.get(`/api/v1/wallets/${wallet.id}/accounts`, {
      headers: H,
    })
  ).json()) as { id: number; name: string }[];
  const checking = accounts.find((a) => a.name === "Checking");
  expect(checking).toBeTruthy();
  const n = new Date();
  const day = (d: number) =>
    new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, d))
      .toISOString()
      .slice(0, 10);
  for (const tx of [
    { date: day(2), amount: 250000, memo: "salary" },
    { date: day(9), amount: -64050, memo: MEMO },
  ]) {
    const res = await page.request.post(
      `/api/v1/wallets/${wallet.id}/transactions`,
      { headers: H, data: { accountId: checking!.id, ...tx } },
    );
    expect(res.ok()).toBe(true);
  }

  await page.goto("/");
  await page.getByRole("link", { name: "AI insights" }).click();
  await expect(page).toHaveURL(/\/insights$/);
  await page.getByRole("button", { name: "Generate now" }).click();
  await expect(report(page)).toContainText("A quiet month");
  await expect(report(page).getByText("1250.00 EUR")).toHaveCSS(
    "font-family",
    /Plex Mono|monospace/,
  );
  await report(page).getByRole("button", { name: "Why?" }).click();
  await expect(report(page).getByRole("cell", { name: "Income" })).toBeVisible();

  // The model got the numbers, never the memo.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain("2500.00");
  expect(sent).not.toContain(MEMO);
});

test("the AI box's colours flow, and stop when asked", async ({ page }) => {
  await signIn(page);
  await page.goto("/insights");
  await expect(report(page)).toBeVisible();
  expect(await animation(page)).not.toBe("none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animation(page)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await setAI(page, { motion: false });
  await page.reload();
  await expect(report(page)).toHaveAttribute("data-motion", "off");
  expect(await animation(page)).toBe("none");
});

test("with reports off the page leaves the sidebar", async ({ page }) => {
  await signIn(page);
  await setAI(page, {
    motion: true,
    features: { suggest: false, entry: false, mail: true, reports: false },
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "AI insights" })).toHaveCount(0);
  await page.goto("/insights");
  await expect(page.getByText("The AI does not write reports")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Settings › AI" }),
  ).toBeVisible();
});
