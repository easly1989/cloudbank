import { expect, test, type Page } from "@playwright/test";

// Bank mails (#657) all the way through, with nothing in between mocked: a
// CloudBank signs in to a pretend Microsoft (mail/../server/cmd/e2e-mail),
// reads its IMAP folder, and a pattern made in the editor turns the bank's
// mails into transactions in the register. Every mail is invented. The steps
// build on each other, so they run in order.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
const ADDRESS = "notifiche.demo@example.com";
const BANK = "avvisi@banca.example";

const card = (amount: string, shop: string) => ({
  folder: "Banca",
  from: BANK,
  subject: "Pagamento con carta",
  body:
    `Gentile cliente, ti informiamo che è stato richiesto un pagamento di ${amount} EUR ` +
    `con la carta 1234_*_*_5678 presso ${shop}, - ore 17:56\nBanca Demo`,
  authenticated: true,
});

async function deliver(page: Page, mail: ReturnType<typeof card>) {
  const res = await page.request.post(`${FAKE}/deliver`, { data: mail });
  expect(res.status()).toBe(204);
}

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

/** Selects a piece of the sample mail, as a person does with the mouse. */
async function select(page: Page, piece: string) {
  await page.getByTestId("pattern-sample").evaluate((root, piece) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      const i = t.data.indexOf(piece);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + piece.length);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    throw new Error(`not in the mail: ${piece}`);
  }, piece);
  await expect(page.getByTestId("pattern-pick")).toBeVisible();
}

const history = (page: Page) => page.getByTestId("mailbox-card");

test("a fresh server, with a wallet and an account", async ({ page }) => {
  const setup = await page.request.post("/api/v1/setup", {
    headers: H,
    data: { ...USER, email: "admin@example.com" },
  });
  expect(setup.ok()).toBe(true);
  await signIn(page);
  await page.request.patch("/api/v1/auth/me", {
    headers: H,
    data: {
      locale: "en",
      preferences: { tutorialSeen: true, tourOffers: false },
    },
  });
  const wallet = await (
    await page.request.post("/api/v1/wallets", {
      headers: H,
      data: { title: "Demo", baseCurrency: "EUR" },
    })
  ).json();
  const acc = await page.request.post(`/api/v1/wallets/${wallet.id}/accounts`, {
    headers: H,
    data: { name: "Checking", type: "bank" },
  });
  expect(acc.status()).toBe(201);
});

test("with no mailbox, the page's tour only says how to connect one", async ({
  page,
}) => {
  // #677: the tour's first step is the mailbox, so the page offers nothing
  // yet, and its ? shows the one step that applies.
  await signIn(page);
  await page.goto("/settings/mail");
  await page.locator('[data-tour-replay="mail"]').click();
  const card = page.locator("[data-tour-step]");
  await expect(card).toContainText("Connect a mailbox");
  await expect(card.getByText("1 / 1")).toBeVisible();
  await card.getByRole("button", { name: "Done" }).click();
  await expect(card).toHaveCount(0);
});

test("signing in to Microsoft connects the mailbox", async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  await page.getByRole("button", { name: "Sign in with Microsoft" }).click();
  const code = (await page.getByTestId("mail-user-code").textContent())!.trim();
  expect(code).toMatch(/^E2E\d{4}$/);

  // The person opens Microsoft's page, as the dialog says, and allows it.
  const [ms] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("dialog").getByRole("link").first().click(),
  ]);
  await ms.getByLabel("Code").fill(code);
  await ms.getByRole("button", { name: "Allow" }).click();
  await expect(ms.getByRole("status")).toHaveText(/Signed in/);
  await ms.close();

  await expect(page.getByText(`Mailbox connected: ${ADDRESS}`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(history(page).getByText(ADDRESS)).toBeVisible();

  // Only the bank's folder is read.
  await history(page).getByLabel("Folder").click();
  await page.getByRole("option", { name: "Banca", exact: true }).click();
  await expect(
    page.getByText("From now on CloudBank reads Banca."),
  ).toBeVisible();
});

test("the bank's mails arrive, and none is recognised yet", async ({
  page,
}) => {
  await signIn(page);
  await deliver(page, card("18,50", "Libreria Demo"));
  await deliver(page, {
    folder: "Banca",
    from: BANK,
    subject: "Bonifico in arrivo",
    body: "Hai ricevuto un bonifico di 250,00 EUR da Mario Demo.\nBanca Demo",
    authenticated: true,
  });
  await deliver(page, card("6,43", "Supermercato Demo 0042"));

  await page.goto("/settings/mail");
  await history(page).getByRole("button", { name: "Check now" }).click();
  await expect(
    history(page).getByText("Not recognised", { exact: true }),
  ).toHaveCount(3);
  await expect(history(page).getByText("Pagamento con carta")).toHaveCount(2);
});

test("a pattern made from one mail writes the transactions of all its kind", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  // The newest mail is first: the supermarket.
  await history(page)
    .getByRole("button", { name: "Create a pattern from this mail" })
    .first()
    .click();
  const sheet = page.getByTestId("pattern-sheet");
  await expect(page.getByTestId("pattern-sample")).toContainText(
    "Supermercato Demo 0042",
  );

  await select(page, "6,43");
  await page
    .getByTestId("pattern-pick")
    .getByRole("button", { name: "Amount", exact: true })
    .click();
  await select(page, "Supermercato Demo 0042");
  await page
    .getByTestId("pattern-pick")
    .getByRole("button", { name: "Memo", exact: true })
    .click();
  await sheet
    .getByLabel(/^Account/)
    .first()
    .click();
  await page.getByRole("option", { name: "Checking", exact: true }).click();

  // Tried on the server, with its own engine, on the mails that came in.
  await expect(page.getByTestId("pattern-test")).toContainText("2 of 3 match");
  await expect(page.getByTestId("pattern-preview")).toContainText(
    "Supermercato Demo 0042",
  );

  await sheet
    .getByRole("checkbox", { name: /Also apply it to the 2 waiting mails/ })
    .check();
  await sheet.getByRole("button", { name: "Save the pattern" }).click();
  await expect(
    page.getByText("Pattern saved: 2 transactions created"),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);

  await expect(history(page).getByText("Created", { exact: true })).toHaveCount(
    2,
  );
  await expect(
    history(page).getByText("Not recognised", { exact: true }),
  ).toHaveCount(1);
  await expect(
    history(page).getByRole("link", { name: /Supermercato Demo 0042/ }),
  ).toBeVisible();
});

test("a pattern for money in is one choice, and the mail's word is not marked", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  // The transfer is the one mail left that no pattern reads.
  const create = history(page).getByRole("button", {
    name: "Create a pattern from this mail",
  });
  await expect(create).toHaveCount(1);
  await create.click();
  const sheet = page.getByTestId("pattern-sheet");
  await expect(page.getByTestId("pattern-sample")).toContainText("Mario Demo");

  // While the direction is fixed, a word of the mail cannot be marked as it.
  await select(page, "ricevuto");
  await expect(
    page.getByTestId("pattern-pick").getByRole("button", { name: "Direction" }),
  ).toHaveCount(0);
  await select(page, "250,00");
  await page
    .getByTestId("pattern-pick")
    .getByRole("button", { name: "Amount", exact: true })
    .click();
  await select(page, "Mario Demo");
  await page
    .getByTestId("pattern-pick")
    .getByRole("button", { name: "Payee", exact: true })
    .click();
  await sheet
    .getByLabel(/^Account/)
    .first()
    .click();
  await page.getByRole("option", { name: "Checking", exact: true }).click();
  await sheet
    .getByLabel(/^Direction/)
    .first()
    .click();
  await page.getByRole("option", { name: "Money in", exact: true }).click();

  await expect(page.getByTestId("pattern-test")).toContainText("1 of 3 match");
  const preview = page.getByTestId("pattern-preview");
  await expect(preview).toContainText("Mario Demo");
  await expect(preview).toContainText("250");
  await expect(preview).not.toContainText("-250");

  await sheet
    .getByRole("checkbox", { name: /Also apply it to the waiting mail/ })
    .check();
  await sheet.getByRole("button", { name: "Save the pattern" }).click();
  await expect(
    page.getByText("Pattern saved: 1 transaction created"),
  ).toBeVisible();
  await expect(
    history(page).getByText("Not recognised", { exact: true }),
  ).toHaveCount(0);
  await expect(
    history(page).getByRole("link", { name: /Mario Demo/ }),
  ).toBeVisible();
});

test("a new mail is heard and written without asking", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/mail");
  await expect(history(page).getByText("Created", { exact: true })).toHaveCount(
    3,
  );
  await deliver(page, card("1,20", "Bar Demo"));
  // The listener hears it over IMAP IDLE; the page refreshes on its own.
  await expect(async () => {
    await page.reload();
    await expect(
      history(page).getByRole("link", { name: /Bar Demo/ }),
    ).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 45_000 });
  await expect(history(page).getByText("Created", { exact: true })).toHaveCount(
    4,
  );
});

test("a mail whose sender is not authenticated writes nothing", async ({
  page,
}) => {
  await signIn(page);
  await deliver(page, {
    ...card("99,00", "Negozio Falso"),
    authenticated: false,
  });
  await page.goto("/settings/mail");
  await history(page).getByRole("button", { name: "Check now" }).click();
  await expect(
    history(page).getByText("Not authenticated", { exact: true }),
  ).toHaveCount(1);
  await expect(
    history(page).getByRole("link", { name: /Negozio Falso/ }),
  ).toHaveCount(0);
});

test("one pattern covers two wordings of a notice, marked in a mail of each", async ({
  page,
}) => {
  // Another bank (#674): the card written with and without a space, and
  // another ending after the merchant.
  const OTHER = "notifiche@altra-banca.example";
  const mail = (subject: string, body: string) => ({
    folder: "Banca",
    from: OTHER,
    subject,
    body,
    authenticated: true,
  });
  await signIn(page);
  await deliver(
    page,
    mail(
      "Bonifico in arrivo",
      "Sul tuo conto è arrivato un bonifico di 80,00 EUR.",
    ),
  );
  await deliver(
    page,
    mail(
      "Pagamento con carta",
      "È stato effettuato un pagamento di 41,00 EUR con la carta 1234_*_*_ 5678 presso Farmacia Esempio .",
    ),
  );
  await deliver(
    page,
    mail(
      "Pagamento con carta",
      "È stato richiesto un pagamento di 12,50 EUR con la carta 1234_*_*_5678 presso Bar Esempio, - ore 08:12",
    ),
  );
  await page.goto("/settings/mail");
  await history(page).getByRole("button", { name: "Check now" }).click();
  await expect(
    history(page).getByText("Not recognised", { exact: true }),
  ).toHaveCount(3);

  // The newest mail is first: the bar.
  await history(page)
    .getByRole("button", { name: "Create a pattern from this mail" })
    .first()
    .click();
  const sheet = page.getByTestId("pattern-sheet");
  await expect(page.getByTestId("pattern-sample")).toContainText("Bar Esempio");
  const mark = async (amount: string, memo: string) => {
    for (const [piece, field] of [
      [amount, "Amount"],
      [memo, "Memo"],
    ]) {
      await select(page, piece);
      await page
        .getByTestId("pattern-pick")
        .getByRole("button", { name: field, exact: true })
        .click();
    }
  };
  await mark("12,50", "Bar Esempio");
  await sheet
    .getByLabel(/^Account/)
    .first()
    .click();
  await page.getByRole("option", { name: "Checking", exact: true }).click();
  await expect(page.getByTestId("pattern-test")).toContainText("1 of 3 match");

  // The transfer differs from the start: another kind of notice, no button.
  const unread = page.locator(
    '[data-testid="pattern-test-mail"][data-read="false"]',
  );
  await expect(unread.filter({ hasText: "Bonifico in arrivo" })).toContainText(
    "another kind of notice?",
  );
  // The pharmacy stops at the card, written with a space.
  await unread
    .filter({ hasText: "Pagamento con carta" })
    .getByRole("button")
    .click();
  const stop = page.getByTestId("pattern-stop");
  await expect(stop).toContainText("1234_*_*_5678 presso");
  await expect(stop).toContainText("1234_*_*_ 5678 presso");
  await stop
    .getByRole("button", { name: "Mark the fields in this mail too" })
    .click();

  await expect(page.getByTestId("pattern-samples")).toBeVisible();
  await expect(page.getByTestId("pattern-sample")).toContainText(
    "Farmacia Esempio",
  );
  await expect(page.getByTestId("pattern-same-fields")).toContainText(
    "Amount, Memo",
  );
  await mark("41,00", "Farmacia Esempio");
  await expect(page.getByTestId("pattern-test")).toContainText("2 of 3 match");
  await expect(
    page.getByText("Now it also reads 1 mail it did not read before: check it"),
  ).toBeVisible();

  await sheet
    .getByRole("checkbox", { name: /Also apply it to the 2 waiting mails/ })
    .check();
  await sheet.getByRole("button", { name: "Save the pattern" }).click();
  await expect(
    page.getByText("Pattern saved: 2 transactions created"),
  ).toBeVisible();
  await expect(
    history(page).getByRole("link", { name: /Farmacia Esempio/ }),
  ).toBeVisible();

  // It reopens on both example mails.
  await page
    .getByRole("button", { name: /Actions for Pagamento con carta/ })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByTestId("pattern-samples")).toContainText(
    "Farmacia Esempio",
  );
});

test("the written transactions are in the register, opened from the mail", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  await history(page)
    .getByRole("link", { name: /Supermercato Demo 0042/ })
    .click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&txn=\d+/);
  const grid = page.getByRole("main");
  for (const memo of [
    "Supermercato Demo 0042",
    "Libreria Demo",
    "Bar Demo",
    "Mario Demo",
  ]) {
    await expect(grid.getByText(memo, { exact: true }).first()).toBeVisible();
  }
  await expect(grid.getByText("Negozio Falso")).toHaveCount(0);
});

test("the page's tour points at every part of a connected mailbox", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  await page.locator('[data-tour-replay="mail"]').click();
  const card = page.locator("[data-tour-step]");
  // No step left out for want of its element, none centred for want of size.
  await expect(card).toHaveAttribute("data-tour-skipped", "0");
  for (let i = 1; i <= 6; i++) {
    await expect(card.getByText(`${i} / 6`)).toBeVisible();
    await expect(card, `step ${i}`).not.toHaveAttribute(
      "data-tour-centred",
      /.*/,
    );
    await card.getByRole("button", { name: i < 6 ? "Next" : "Done" }).click();
  }
  await expect(card).toHaveCount(0);
});
