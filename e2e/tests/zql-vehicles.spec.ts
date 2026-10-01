import { type Page, expect, test } from "@playwright/test";

// The Vehicles page (#574): a row per vehicle with what its fuel cost over the
// last twelve months, the kilometres, the cost of one, the litres per 100 km
// and the last fill, read from the odometer and litres in the memos. A vehicle
// with nothing linked says how to link it; the sheet edits the vehicle and
// lists its latest fills; Report opens the Reports page on it, from the row,
// ⋯ and a right click; deleting says how many payments lose their vehicle.
// On a wallet of its own, seeded here.
// Named "zql-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const monthDay = (back: number, day: number) => {
  const i = now.getFullYear() * 12 + now.getMonth() - back;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}-${pad(day)}`;
};

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, dates }) => {
      const call = async (method: string, url: string, body?: unknown) => {
        const r = await fetch(url, {
          method,
          headers: h,
          body: body ? JSON.stringify(body) : undefined,
        });
        return r.status === 204 ? null : r.json();
      };
      const needsSetup = (await call("GET", "/api/v1/setup/status"))
        .needsSetup as boolean;
      await call(
        "POST",
        needsSetup ? "/api/v1/setup" : "/api/v1/auth/login",
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      );
      const me = await call("GET", "/api/v1/auth/me");
      await call("PATCH", "/api/v1/auth/me", {
        preferences: {
          ...(me.preferences ?? {}),
          tutorialSeen: true,
          tourOffers: false,
        },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Vehicles ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const card = await call("POST", `${base}/accounts`, {
        name: "Card",
        type: "bank",
      });
      const car = await call("POST", `${base}/vehicles`, {
        name: "Family car",
        plate: "AB 123 CD",
        notes: "Petrol",
      });
      const scooter = await call("POST", `${base}/vehicles`, {
        name: "Scooter",
        plate: "",
        notes: "",
      });
      // One fill from more than a year ago, then three full tanks 600 km
      // apart and a top-up: 1.500 km and 193,80 in the last twelve months.
      const fills: [string, number, string][] = [
        [dates.old, -5000, "d=9000 v=30 p=1.667"],
        [dates.m3, -5400, "d=10000 v=30 p=1.8"],
        [dates.m2, -5400, "d=10600 v=30 p=1.8"],
        [dates.m1, -5580, "d=11200 v=31 p=1.8"],
        [dates.m1b, -3000, "d=11500 p=1.8"],
      ];
      for (const [date, amount, memo] of fills)
        await call("POST", `${base}/transactions`, {
          accountId: card.id,
          date,
          amount,
          memo,
          vehicleId: car.id,
        });
      return {
        wallet: w.id as number,
        car: car.id as number,
        scooter: scooter.id as number,
      };
    },
    {
      h: H,
      dates: {
        old: monthDay(14, 7),
        m3: monthDay(3, 7),
        m2: monthDay(2, 7),
        m1: monthDay(1, 7),
        m1b: monthDay(1, 21),
      },
    },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

test("vehicles: the year's figures, the sheet, the report and deleting", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/vehicles");
  const row = (id: number) => page.getByTestId(`vehicle-row-${id}`);
  const sheet = page.getByTestId("vehicle-sheet");

  await test.step("a row per vehicle, its last twelve months", async () => {
    const car = row(ids.car);
    await expect(car).toContainText("AB 123 CD");
    await expect(car).toContainText(/193[.,]80/);
    await expect(car).toContainText("4 fills");
    await expect(car).toContainText(/1[.,]?500 km/);
    await expect(car).toContainText(/0[.,]13/);
    // 61 litres over the 1.200 km between full tanks.
    await expect(car).toContainText(/5[.,]1 L/);
    await expect(car).toContainText(/11[.,]?500 km on the clock/);
    await expect(row(ids.scooter)).toContainText(
      "No fuel payments linked yet. Pick “Scooter” in a payment's Vehicle field to start.",
    );
    await expect(page.getByText(/The last 12 months\./)).toBeVisible();
  });

  await test.step("the sheet edits it and lists its latest fills", async () => {
    await row(ids.car).click();
    await expect(sheet).toContainText("4 fuel payments in the last 12 months");
    await expect(sheet.getByTestId("vehicle-figures")).toContainText(
      /193[.,]80/,
    );
    // The five newest fills ever, the old one included, newest first.
    const fills = sheet.getByTestId("vehicle-recent");
    await expect(fills.locator("> div")).toHaveCount(5);
    await expect(fills.locator("> div").first()).toContainText("partial");
    await expect(fills.locator("> div").last()).toContainText(/9[.,]?000 km/);
    await sheet.getByLabel("Plate").fill("ZZ 999 ZZ");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(row(ids.car)).toContainText("ZZ 999 ZZ");
  });

  await test.step("a vehicle with nothing linked says how to link it", async () => {
    await row(ids.scooter).click();
    await expect(sheet).toContainText("No fuel payments linked yet");
    await expect(sheet).toContainText("d=41250 v=32.5");
    // A name may not repeat another's, whatever its case.
    await sheet.getByLabel("Name").fill("family car");
    await expect(
      sheet.getByText("There is already a vehicle called Family car."),
    ).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  await test.step("a right click opens the report", async () => {
    await row(ids.car).click({ button: "right", position: { x: 600, y: 20 } });
    await page.getByRole("menuitem", { name: "Open the report" }).click();
    await expect(page).toHaveURL(new RegExp(`tab=vehicle&v=${ids.car}`));
    await expect(page.getByTestId("vehicle-cost")).toBeVisible();
    await page.goBack();
  });

  await test.step("deleting says how many payments lose their vehicle", async () => {
    await row(ids.car)
      .getByRole("button", { name: "Actions for Family car" })
      .click();
    await page.getByRole("menuitem", { name: "Delete vehicle" }).click();
    const ask = page.getByRole("dialog").filter({ hasText: "Delete" });
    await expect(ask).toContainText(
      "Its 5 fuel payments stay in the register, no longer linked to any vehicle.",
    );
    await ask.getByRole("button", { name: "Delete vehicle" }).click();
    await expect(row(ids.car)).toHaveCount(0);

    await row(ids.scooter)
      .getByRole("button", { name: "Actions for Scooter" })
      .click();
    await page.getByRole("menuitem", { name: "Delete vehicle" }).click();
    await expect(ask).toContainText("No fuel payments are linked to it.");
    await ask.getByRole("button", { name: "Delete vehicle" }).click();
  });

  await test.step("empty is an invitation that explains the memo", async () => {
    const empty = page.getByTestId("vehicles-empty");
    await expect(empty).toContainText("See what a vehicle costs to run");
    await expect(empty.locator("li")).toHaveCount(3);
    await expect(empty).toContainText("d=41250 v=32.5");
    await empty.getByRole("button", { name: "Add vehicle" }).click();
    await expect(sheet).toContainText("New vehicle");
  });
});
