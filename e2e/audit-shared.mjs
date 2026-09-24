// What the accessibility audits share: where the app is, which pages to walk,
// and how to get into it with something on screen.
//
// Data matters. An audit can only measure what is rendered, and an empty wallet
// renders no rows, so no row actions, no badges, no amounts — the contrast audit
// reported clean on a bare instance and found five failures the moment it was
// pointed at a seeded one. So `signIn` imports the sample HomeBank file into a
// wallet of its own the first time, and makes that wallet the current one.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = process.env.CB_BASE_URL ?? "http://localhost:8080";

export const PAGES = [
  "/",
  "/accounts",
  "/transactions",
  "/templates",
  "/tags",
  "/assignments",
  "/schedules",
  "/bills",
  "/budget",
  "/goals",
  "/bank-sync",
  "/review",
  "/reports",
  "/vehicles",
  "/categories",
  "/payees",
  "/settings",
];

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/sample.xhb",
);
const SEEDED_TITLE = "Audit sample";
const HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

// signIn sets the admin up on a fresh instance or logs in on an existing one,
// switches the tour off (its backdrop would sit over every page being measured),
// and lands on a wallet holding the sample data.
export async function signIn(page) {
  const api = page.request;
  const { needsSetup } = await (
    await api.get(BASE + "/api/v1/setup/status")
  ).json();
  const creds = { username: "admin", password: "supersecret1" };
  await api.post(BASE + (needsSetup ? "/api/v1/setup" : "/api/v1/auth/login"), {
    headers: HEADERS,
    data: needsSetup ? { ...creds, email: "a@b.com" } : creds,
  });
  await api.patch(BASE + "/api/v1/auth/me", {
    headers: HEADERS,
    data: { preferences: { tutorialSeen: true, tourOffers: false } },
  });

  let wallets = await (await api.get(BASE + "/api/v1/wallets")).json();
  let seeded = wallets.find((w) => w.title === SEEDED_TITLE);
  if (!seeded) {
    const res = await api.post(BASE + "/api/v1/import/xhb", {
      headers: {
        "Content-Type": "application/xml",
        "X-Requested-With": "XMLHttpRequest",
      },
      data: readFileSync(FIXTURE),
    });
    if (!res.ok())
      throw new Error(
        `importing the sample failed: ${res.status()} ${await res.text()}`,
      );
    const imported = await res.json();
    const id = imported.walletId ?? imported.wallet?.id ?? imported.id;
    await api.patch(BASE + `/api/v1/wallets/${id}`, {
      headers: HEADERS,
      data: { title: SEEDED_TITLE },
    });
    wallets = await (await api.get(BASE + "/api/v1/wallets")).json();
    seeded =
      wallets.find((w) => w.title === SEEDED_TITLE) ??
      wallets.find((w) => w.id === id);
  }

  // The current wallet is remembered per browser, so say which one before the
  // app first reads it.
  await page.goto(BASE + "/");
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    seeded.id,
  );
  await page.goto(BASE + "/");
  await page.waitForLoadState("networkidle");
  return seeded.id;
}

// settle waits for a page to finish loading and drawing.
export async function settle(page, ms = 400) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(ms);
}
