import {
  expect,
  request,
  test,
  type Browser,
  type Page,
} from "@playwright/test";

import { PAGES } from "../pages";
import {
  findProblems,
  LANGUAGES,
  NAMESPACES,
  WIDTHS,
  type Problem,
} from "./checks";

// The language check (#614): every page, in every language, at the widths where
// a longer word breaks a layout. Runs against the demo build, which fills a new
// account with a year of data in the language the browser asks for, so each
// page shows real names, real amounts and real lists, not empty states.

/** A demo account in that language, its cookie ready for a browser context. */
async function demoSession(lang: string) {
  const ctx = await request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    extraHTTPHeaders: {
      "Accept-Language": lang,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const res = await ctx.post("/api/v1/demo/session");
  expect(res.ok(), `demo session for ${lang}: ${res.status()}`).toBeTruthy();
  // The welcome notice and the tours would cover the pages.
  await ctx.patch("/api/v1/auth/me", {
    data: {
      preferences: {
        demoNoticeSeen: true,
        tourOffers: false,
        tutorialSeen: true,
      },
    },
  });
  const state = await ctx.storageState();
  await ctx.dispose();
  return state;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // A fallback font is narrower than the real one, and would hide a cut.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function problemsOn(page: Page): Promise<string[]> {
  const found: Problem[] = await page.evaluate(findProblems, NAMESPACES);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  const lines = found.map(
    (p) => `${p.kind} ${p.where}: ${p.text.slice(0, 80)}`,
  );
  if (overflow > 1) lines.unshift(`page overflows by ${overflow}px`);
  return [...new Set(lines)];
}

async function openContext(
  browser: Browser,
  lang: string,
  width: number,
  state?: object,
) {
  return browser.newContext({
    locale: lang,
    viewport: { width, height: width < 768 ? 844 : 900 },
    storageState: state as never,
  });
}

test("a button whose words do not fit is reported", async ({ page }) => {
  await page.setContent(`
    <style>
      button { width: 80px; overflow: hidden; white-space: nowrap; }
      button span { display: block; overflow: hidden; text-overflow: ellipsis; }
    </style>
    <button id="cut"><span>Riconcilia tutte le transazioni</span></button>
    <button id="fits"><span>OK</span></button>
    <button data-truncate-ok><span>Conto corrente cointestato principale</span></button>
    <div data-truncate><button><span>Carta di credito aziendale</span></button></div>
    <div style="width: 120px; overflow: hidden; display: flex">
      <button style="flex: none">Mese</button><button style="flex: none">Anno</button>
    </div>
    <p>accounts.addTitle e {{count}}</p>
  `);
  const found = await page.evaluate(findProblems, NAMESPACES);
  expect(
    found.filter((p) => p.kind === "truncated").map((p) => p.text),
  ).toEqual(["Riconcilia tutte le transazioni"]);
  expect(found.filter((p) => p.kind === "clipped").map((p) => p.text)).toEqual([
    "Anno",
  ]);
  expect(found.filter((p) => p.kind === "raw-key").map((p) => p.text)).toEqual([
    "accounts.addTitle",
  ]);
  expect(
    found.filter((p) => p.kind === "placeholder").map((p) => p.text),
  ).toEqual(["{{count}}"]);
});

for (const lang of LANGUAGES) {
  test.describe(lang, () => {
    let state: Awaited<ReturnType<typeof demoSession>>;
    test.beforeAll(async () => {
      state = await demoSession(lang);
    });

    for (const width of WIDTHS[lang]) {
      test(`every page at ${width}px`, async ({ browser }) => {
        test.setTimeout(180_000);
        const ctx = await openContext(browser, lang, width, state);
        const page = await ctx.newPage();
        const report: string[] = [];

        for (const path of PAGES) {
          await page.goto(path);
          await settle(page);
          await expect(page.locator("html")).toHaveAttribute("lang", lang);
          for (const line of await problemsOn(page))
            report.push(`${path}  ${line}`);
        }
        await ctx.close();

        // The front door, before anyone is signed in.
        const anon = await openContext(browser, lang, width);
        const door = await anon.newPage();
        await door.goto("/login");
        await settle(door);
        for (const line of await problemsOn(door))
          report.push(`/login  ${line}`);
        await anon.close();

        expect(report, `${lang} at ${width}px:\n${report.join("\n")}`).toEqual(
          [],
        );
      });
    }
  });
}
