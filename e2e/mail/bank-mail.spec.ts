import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** The wallet and the one mailbox this spec works on. */
async function walletId(page: Page): Promise<number> {
  const wallets = await (await page.request.get("/api/v1/wallets")).json();
  return wallets[0].id;
}
async function mailboxId(page: Page): Promise<number> {
  const mail = await (
    await page.request.get(`/api/v1/wallets/${await walletId(page)}/mail`)
  ).json();
  return mail.mailboxes[0].id;
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

/** Opens one of a mailbox's sources (#794), closed by default. */
async function openSource(scope: Locator, name = "INBOX") {
  const band = scope
    .getByTestId(/^mail-source-\d+$/)
    .filter({ has: scope.page().getByRole("button", { name, exact: true }) });
  const title = band.getByRole("button", { name, exact: true });
  if ((await title.getAttribute("aria-expanded")) !== "true")
    await title.click();
  return band;
}

/** Opens a mailbox's latest mails, closed by default, on the given filter. */
async function showMails(scope: Locator, filter = "All") {
  const title = scope.getByRole("button", {
    name: "Latest mails",
    exact: true,
  });
  if ((await title.getAttribute("aria-expanded")) !== "true")
    await title.click();
  await scope
    .getByRole("radiogroup", { name: "Which mails" })
    .locator("label")
    .filter({ hasText: new RegExp(`^${filter}`) })
    .click();
}

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

  // A new mailbox has one source on its inbox; only the bank's folder is read.
  const source = await openSource(history(page));
  await source.getByLabel("Folder").click();
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
  // The latest mails start closed; the badge counts them, and its half for the
  // mails to review opens the list on those.
  const toReview = history(page).getByRole("button", { name: "3 to review" });
  await expect(toReview).toBeVisible();
  await expect(
    history(page).getByText("Not recognised", { exact: true }),
  ).toHaveCount(0);
  await toReview.click();
  await expect(
    history(page).getByRole("button", { name: "Latest mails", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    history(page).getByText("Not recognised", { exact: true }),
  ).toHaveCount(3);
  await expect(history(page).getByText("Pagamento con carta")).toHaveCount(2);
});

test("the bell says the mails were not recognised, and opens the mailbox", async ({
  page,
}) => {
  // #685: the alert goes through the dispatcher into the bell, on a phone too.
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
  await expect(bell).toBeVisible();
  await bell.click();
  const note = page.getByRole("button", { name: /Bank mails not recognised/ });
  // Once a day per mailbox: how many depends on how the listener heard them.
  await expect(note).toContainText(ADDRESS);
  await note.click();
  await expect(page).toHaveURL(/\/settings\/mail$/);
  // Read now: the badge is gone, and the bell in the Settings header agrees.
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toBeVisible();
});

test("the first pattern offers the editor's tour, once, and Escape leaves the draft", async ({
  page,
}) => {
  // #678: offered at the top of the sheet, since the page's corner card sits
  // below dialogs. The page's own tour counts as seen, so it offers nothing.
  await signIn(page);
  const prefs = (tourOffers: boolean) =>
    page.request.patch("/api/v1/auth/me", {
      headers: H,
      data: {
        preferences: {
          tutorialSeen: true,
          tourOffers,
          tourSkipAsked: true,
          toursSeen: ["mail"],
        },
      },
    });
  await prefs(true);
  const create = history(page)
    .getByRole("button", { name: "Create a pattern from this mail" })
    .first();
  const sheet = page.getByTestId("pattern-sheet");
  const offer = sheet.locator("[data-tour-offer]");
  const card = page.locator("[data-tour-step]");

  await page.goto("/settings/mail");
  await showMails(history(page));
  await create.click();
  await offer.getByRole("button", { name: /Show me/ }).click();
  await expect(offer).toHaveCount(0);
  // No step left out for want of its element, none centred for want of size.
  await expect(card).toHaveAttribute("data-tour-skipped", "0");
  for (let i = 1; i <= 7; i++) {
    await expect(card.getByText(`${i} / 7`)).toBeVisible();
    await expect(card, `step ${i}`).not.toHaveAttribute(
      "data-tour-centred",
      /.*/,
    );
    await card.getByRole("button", { name: i < 7 ? "Next" : "Done" }).click();
  }
  await expect(card).toHaveCount(0);

  // Escape leaves the tour, not the pattern being made.
  await sheet.locator('[data-tour-replay="patternEditor"]').click();
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(sheet).toBeVisible();
  // Also when the reader last clicked the card's text, not a button.
  await sheet.locator('[data-tour-replay="patternEditor"]').click();
  await card.getByText("The example mail").click();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toHaveCount(0);

  // Offered once: the next pattern starts without it.
  await page.reload();
  await showMails(history(page));
  await create.click();
  await expect(page.getByTestId("pattern-sample")).toBeVisible();
  await expect(offer).toHaveCount(0);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await prefs(false);
});

test("a pattern made from one mail writes the transactions of all its kind", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  await showMails(history(page));
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
  await showMails(history(page));
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
  await showMails(history(page));
  await expect(history(page).getByText("Created", { exact: true })).toHaveCount(
    3,
  );
  await deliver(page, card("1,20", "Bar Demo"));
  // The listener hears it over IMAP IDLE; the page refreshes on its own.
  await expect(async () => {
    await page.reload();
    await showMails(history(page));
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
  await showMails(history(page));
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
  // With the mail the forged sender sent before, 4 are to review.
  await expect(
    history(page).getByRole("button", { name: "4 to review" }),
  ).toBeVisible();
  await showMails(history(page));
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
  await openSource(history(page));
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
  await showMails(history(page));
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

test("a second source on the same folder: the mail goes to the first that reads it", async ({
  page,
}) => {
  // #794: up to 5 sources per mailbox, each a name and a folder; a mail two
  // sources could read goes to the first in the order.
  await signIn(page);
  await page.goto("/settings/mail");
  const box = history(page);
  await box.getByRole("button", { name: "New source" }).click();
  const draft = box.getByTestId("mail-source-new");
  await draft.getByLabel("Name").fill("Cards");
  await draft.getByLabel("Folder").click();
  await page.getByRole("option", { name: "Banca", exact: true }).click();
  await draft.getByRole("button", { name: "Add source" }).click();
  await expect(box.getByText("2 of 5")).toBeVisible();
  // The new source opens; it has no pattern, so the first source still reads
  // the bank's card mails, and the mail says which source read it.
  await expect(
    box.getByRole("button", { name: "Cards", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await deliver(page, card("3,10", "Edicola Demo"));
  await box.getByRole("button", { name: "Check now" }).first().click();
  await showMails(box);
  const row = box
    .getByTestId("mail-row")
    .filter({ has: page.getByRole("link", { name: /Edicola Demo/ }) });
  await expect(row).toContainText("INBOX");

  // Cards moves up: it is first now.
  await box.getByRole("button", { name: "Actions for Cards" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(box.getByTestId(/^mail-source-\d+$/).first()).toContainText(
    "Cards",
  );

  // Three more make five, and a sixth is refused with the reason beside it.
  for (const name of ["Two", "Three", "Four"]) {
    const res = await page.request.post(
      `/api/v1/wallets/${await walletId(page)}/mail/mailboxes/${await mailboxId(page)}/sources`,
      { headers: H, data: { name, folder: "INBOX" } },
    );
    expect(res.status()).toBe(201);
  }
  await page.reload();
  const add = box.getByRole("button", { name: "New source" });
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await expect(box.getByText("At most 5 sources per mailbox")).toBeVisible();

  // Deleting a source keeps the mails it read.
  for (const name of ["Two", "Three", "Four", "Cards"]) {
    await box.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Delete source" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete source" })
      .click();
    await expect(box.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await showMails(box);
  await expect(box.getByRole("link", { name: /Edicola Demo/ })).toBeVisible();
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
  for (let i = 1; i <= 4; i++) {
    await expect(card.getByText(`${i} / 4`)).toBeVisible();
    await expect(card, `step ${i}`).not.toHaveAttribute(
      "data-tour-centred",
      /.*/,
    );
    await card.getByRole("button", { name: i < 4 ? "Next" : "Done" }).click();
  }
  await expect(card).toHaveCount(0);
});
