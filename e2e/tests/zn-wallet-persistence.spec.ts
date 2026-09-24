import { expect, test, type Page } from "@playwright/test";

// The wallet you were last looking at is the one you come back to.
//
// `WalletProvider` resolves the current wallet during render and writes it to
// localStorage from an effect. The two halves are easy to separate wrongly —
// resolve without remembering, and every reload lands on the first wallet; or
// remember an id that no longer names a wallet, and the app opens on nothing.
//
// Named "zn-" so it runs after the main journey (smoke.spec.ts), whose admin it
// reuses; like the others it also sets itself up when run alone.

async function signIn(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    const h = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
      .needsSetup as boolean;
    await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify(
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      ),
    });
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify({
        preferences: { tutorialSeen: true, tourOffers: false },
      }),
    });
    // Two wallets, so "the current one" is a choice rather than the only option.
    const titles = ["Wallet one", "Wallet two"];
    const have = (await (
      await fetch("/api/v1/wallets", { credentials: "same-origin" })
    ).json()) as { title: string }[];
    for (const title of titles) {
      if (!have.some((w) => w.title === title)) {
        await fetch("/api/v1/wallets", {
          method: "POST",
          credentials: "same-origin",
          headers: h,
          body: JSON.stringify({ title, baseCurrency: "EUR" }),
        });
      }
    }
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

test("the wallet you switched to is still current after a reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);

  const switcher = page.getByRole("button", { name: "Switch wallet" });
  await switcher.click();
  await page.getByRole("menuitem", { name: "Wallet two" }).click();
  await expect(switcher).toContainText("Wallet two");

  await page.reload();
  await expect(switcher).toContainText("Wallet two");

  // A stored id that names nothing must not leave the app on no wallet at all.
  await page.evaluate(() =>
    localStorage.setItem("cb.currentWalletId", "999999"),
  );
  await page.reload();
  // Which wallet it falls back to is the first one, whatever the instance has —
  // running after the main journey there are more than this test made.
  const titles = (await page.evaluate(async () => {
    const all = (await (
      await fetch("/api/v1/wallets", { credentials: "same-origin" })
    ).json()) as { title: string }[];
    return all.map((w) => w.title);
  })) as string[];
  await expect(switcher).toContainText(titles[0]);
});
