# Changelog

All notable changes to CloudBank are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.2.0] — 2026-09-25

The redesign. Every screen was rebuilt to one measured design — the shell, the
register, the overview, settings and the secondary pages — and checked against it
by measuring rather than by eye. Around it: an entry sheet beside the ledger that
you arrange yourself, page tours, and a public demo to try it all without
installing anything.

### Changed

- **Entering a transaction happens beside the ledger, not on top of it.** The
  entry form is now a panel that slides in from the right: the rows and the
  running balance stay visible while you type, and adding several in a row no
  longer blanks the page between each one.

  Modals are kept for the one thing they are good at — stopping you before
  something you cannot undo — and those now say what will actually happen
  ("they are gone for good, and the running balance of every later row
  changes") with buttons that name the action instead of "OK" and "Cancel".
  Deleting a transfer says plainly that it removes both entries, which is the
  part people do not expect. Dismissing one, however you dismiss it, counts as
  "no".

  The browser's own confirmation box is now gone from the whole app — accounts,
  payees, tags, templates, schedules, rules, goals, vehicles, API tokens, bank
  connections, the dashboard layout and the navigation menu. Each of those
  questions now names its consequence rather than restating itself: deleting a
  payee says the transactions stay but are left without one, deleting a tag says
  it comes off every transaction that carries it, removing a bank connection
  says the transactions already imported are kept. All of it is translated,
  which the browser's box never was.

- **Every page opens the same way.** One header across the whole app: the name
  of the page, a line saying what the page is actually for, and its actions on
  the right — instead of the hint floating above the buttons on one page, below
  them on the next, and missing on a third. On a phone the buttons drop under
  the title rather than squeezing it.

  A page with nothing on it yet now says what it is for and offers the first
  step, instead of a grey line reading "No rules yet.": rules explain that they
  read the text your bank sends so you stop retyping the same thing every month,
  and there is a button right there to write one.

  Statuses are words again. Mantine sets badges in capitals, which made
  "OVERDUE" and "PAID" the loudest thing on a row of figures you actually came
  to read; a status is now a word with a small coloured dot, and the colour
  still carries the meaning.

- **The ledger got its screen back, and its first line is the way in.** Filters
  and columns open beside the transactions instead of unfolding above them:
  everything they used to take, they took from the rows, and the rows are the
  page. On the side they cost width, which a ledger has to spare.

  Adding a transaction starts where the transaction will land — the first line
  of the register, or the N key — instead of a form sitting above it. The entry
  sheet opens beside the rows, which is where entering one belongs.

  The notice about rows a filter is hiding is one line now rather than a boxed
  alert. The register is explaining itself, not raising an alarm.

- **The register says which account it is, and what is hiding rows.** The page
  was called "Transactions" with the account in a dropdown beside the title —
  the same thing named twice, neither of them the subject. The account is the
  title now, and switching it is still one click, because the title is the
  switch. Searching is a field on the page instead of a control inside a panel
  that starts closed, since narrowing a ledger by text is the commonest thing
  anyone does to it.

  Active filters are chips you can read. A badge saying "3" told you that three
  filters were on without saying which, so the only way to find out was to open
  the panel and inspect every control; each filter now names itself and can be
  dropped on its own without disturbing the others.

- **The overview answers the question you opened it for.** It led with three
  bordered cards of balances and a donut. It now leads with one figure at forty
  pixels — what you have — and beside it what the period earned, spent and kept,
  so the balance has an explanation next to it rather than two more balances.
  The period is a row of segments (month through all time) instead of a dropdown,
  because five choices switched constantly deserve one click each.

  The widgets below lost their frames. A dozen bordered rectangles read as a
  form; as sections separated by air and a hairline, the figures inside go back
  to being the subject. "Where your money goes" is a list of rows now — name,
  amount, and a bar scaled against the largest — which survives being a third of
  the page wide, where a donut and its legend did not.

  Which balances appear is yours: Settings offers today, reconciled and after
  everything scheduled, and the ones you pick show on the overview and above the
  register both.

- **The gear is where it was drawn.** The style tile put it at the foot of the
  sidebar, beside your name; it had shipped as an entry at the end of the
  navigation list, which on a 1280x720 laptop sits 126px below the fold. The
  foot no longer scrolls with the pages, so the one destination you reach from
  anywhere is always on screen. Your name and the sign-out moved down there with
  it, which is also where the tile had them.

  Asking for support moved out of the header and stopped shouting. It was a
  filled red pill beside the ledger, which is the one place a red pill should
  never be — it reads as an alarm about your own money. It is now an outlined
  accent pill at the foot of the sidebar, quiet until you reach for it.

- **The text you were meant to read is now readable.** The whole app was
  measured against WCAG AA in both themes rather than eyeballed, and it was not
  passing. The "dimmed" grey that carries every page hint and every empty state
  sat at 3.3:1 in light and 3.5:1 in dark, under the 4.5:1 floor — the text
  explaining what a page is for was the hardest text on it. Error messages used
  a red that read at 3.3:1 on a white card, so the one message you must not miss
  was the faintest. And the donate pill put white on a gradient that fell to
  2.7:1 at its brightest point: it was least readable exactly where it was
  loudest.

  All three are fixed, along with the avatar initials, and `e2e/contrast-audit.mjs`
  keeps them fixed — it walks every page in both schemes and fails if anything
  drops under the floor.

- **The register's columns are yours.** Move them into the order you want, drag
  the edge of a heading to widen one, click a heading to sort by it — both remembered per user, so the
  register you arranged is the one you get back on another device. Sorting never
  recomputes the running balance: that figure belongs to its row, and a sorted
  register is a way of *finding* a transaction rather than of reading balances
  down the page.

- **Hide names and amounts for a screenshot.** One button in the register blurs
  payees, memos and figures while leaving dates, categories and the shape of the
  page legible — so a screenshot still shows how CloudBank works without showing
  what you earn. It is per-session on purpose: something you switch on for a
  moment, not a mode to wake up in.

- **The register puts the ledger first.** The three balances are a single line in
  the page header instead of three bordered cards in a block, and the filter
  panel starts closed — between them they were costing most of the screen above
  the transactions, which are what the page is for. A filtered register now also
  says when it is hiding newer rows: ask for everything unreconciled and the top
  line can be weeks old, which looks like the balance has drifted when it hasn't,
  so the register explains itself rather than leaving you to work it out.

- **Managing people moved into Settings.** Inviting someone or resetting a
  password is something you do twice a year, so it no longer holds a permanent
  row in the main menu: it is a *People* tab inside Settings, shown to admins.
  Existing `/admin/users` links still work — they land on that tab. Sidebar
  group headings also dropped their tracked-out capitals for sentence case,
  which is easier to scan.

### Added

- **Choose how far back the overview looks.** A period control in the header —
  this month, quarter, half-year, year, or all time, which is the default. The
  widgets that cover a span of time follow it, and any one of them can still pin
  a period of its own: a dashboard you already arranged keeps exactly the
  periods you gave it, because a widget you configured is an explicit choice and
  stays that way. Balances are untouched by it, since a balance is not a period
  quantity — it is simply what you have now. The register gained a half-year
  preset along the way.

- **The overview opens with what needs doing.** Above the widgets, a short strip
  lists the handful of things waiting — transactions with no category, overdue
  bills, budgets gone past, pairs that look like duplicates — each with the one
  link that fixes it. It disappears entirely when there is nothing to do, so
  seeing it means something is genuinely waiting. It sits outside the widget
  grid on purpose: widgets are yours to remove, and an overdue bill is not a
  preference.

- **Account balances in the sidebar, if you want them.** Off by default; pick up
  to three accounts in Settings and their balances sit at the foot of the
  sidebar. Only a negative balance is coloured, because colouring the healthy
  ones too would turn the sidebar into a traffic light.

- **The entry sheet shows what a transaction needs, and you decide the rest.**
  By default: date, account, memo, payment, category and the status as a row of
  icons; payee and everything else wait under **More details**. Settings →
  General moves any field either way. **Save and add another** gained a toggle
  that keeps every field for the next entry ("Save and keep"), and each button
  shows its key: ↵ saves and closes, ⇧↵ saves and starts another.

- **Page tours.** Each main page offers a short tour the first time you open it,
  in a card in the corner that never blocks the page, and the **?** in its header
  replays it. They replace the one first-login tutorial, which explained
  everything at once to someone who had not yet seen any of it. Settings →
  General turns the offers off, or resets them.

- **A public demo, and the `:demo` image it runs.** One click makes a throwaway
  account with a year of made-up data, in English or Italian. It is deleted after
  two hours without use, every night and on every update; bank sync talks to a
  pretend bank, and anything that would keep real secrets is switched off. See
  [docs/demo.md](docs/demo.md).

### Fixed

- **Save stays in reach in a long entry sheet.** A split of several lines made
  the sheet taller than the screen, and with its scrollbar hidden nothing said
  Save was further down. The foot now stays at the bottom, and the scrollbar
  shows.
- **"Reconciled up to here" shows when it helps.** It drew in the unfiltered
  register, where each row's status already says the same, and vanished under a
  filter, the one place it helps. It now shows only while a filter hides rows —
  under "Not reconciled", below the last row.
- **Chart axes show money.** The value axes of the dashboard and the reports
  printed stored minor units — 230,000 for a month of 2.300 €. They show the
  amount now, and the Balance report's minimum-balance line is labelled inside
  the chart instead of off its edge.
- **Forms stop overwriting what you type.** Forms, modals, dashboard widgets and
  the bank-sync panels filled themselves in when their data arrived, and a
  slow response could land after you had started typing and replace it.
- **A confirmation opens above the sheet that asked for it**, instead of behind
  it.
- **The register fits a 1280px screen without sideways scrolling**, and the
  spending pie fits on a phone.
- **Controls are the size the design gives them**, and at least 44px on a touch
  screen.
- **Accessibility, measured.** An axe audit (WCAG 2.2 AA, both themes) now finds
  nothing: every close button, input and progress bar has a name, the column
  panel's arrows say which column they move, and the ledger shows a focus ring.
  Sheets, dialogs and collapses no longer move under `prefers-reduced-motion`, and
  the register can be driven by keyboard alone, from the ledger to the sheet to a
  confirmation. The audits stay in `e2e/`.

## [3.1.0 – 3.1.5] — 2026-09-04 → 2026-09-17

Smarter **bank sync** — reconciliation against the entries you already have, a
review page, per-connection schedules and a third provider — the **Bills**
redesign, CAMT.053 import, and the first step of the design system.

### Added

- **A design system underneath the app.** The first step of the restyle: CloudBank
  now has its own blue as the default accent, two bundled typefaces (Public Sans
  for the interface, IBM Plex Mono for every figure, so a column of amounts lines
  up on the decimal), a proper heading scale, and controls that ease between
  colours instead of snapping. Nothing is fetched from a font CDN — the app is
  self-hosted and installs offline.

  The change underneath matters more than the paint: **colour now means one thing
  at a time**. The accent means "you can act here" and nothing else, because you
  can change it; income and expense have their own fixed pair that no longer moves
  when you pick a different accent. Green and red are gone from the accent picker
  for that reason, and a saved accent of green or red falls back to the new
  default until you pick another.

- **Bank sync via Pluggy (Latin America), experimental.** A third provider joins
  SimpleFIN and Enable Banking, on the same bring-your-own-credentials footing.
  Banks are linked in [Meu Pluggy](https://meu.pluggy.ai) — free for personal use
  — and CloudBank only reads them, so there is no consent redirect to set up:
  paste your application's client id and secret, add an item id, link the
  accounts. Credentials are verified when saved rather than at the first sync,
  and a credit card's inverted sign convention is handled, so card spending lands
  as an expense rather than income. Marked experimental: it follows Pluggy's
  published API but has not been exercised against a live bank.

- **Import ISO 20022 CAMT.053 statements.** The end-of-day statement most
  European banks offer as a download is now a first-class import format,
  alongside HomeBank `.xhb`, QIF, OFX/QFX and CSV: pick *CAMT.053* in the import
  assistant and the file runs through the same preview, duplicate detection and
  assignment rules as any other. The bank's own reference for each movement is
  kept, so re-importing an overlapping statement flags the repeats instead of
  duplicating them, and statements exported in ISO-8859-1 or windows-1252 are
  read correctly rather than rejected.

- **Scannable tables** — numbers now use tabular figures app-wide, so amounts and
  balances line up cleanly in columns (the register, every table, the dashboard),
  and tables share one compact, consistent density with a quiet row-hover highlight.
- **Consistent empty states** — list pages (accounts, transactions, schedules,
  templates, budget, payees, categories, rules) now share one centered
  icon-and-message placeholder instead of a bare dimmed line.
- **Grouped sidebar navigation** — the left nav is now organized into collapsible
  sections (Money, Planning, Banking, Insights, Settings) with the dashboard on
  top, so it reads as an ordered, mature menu instead of a long flat list. Collapse
  the sections you don't use (remembered per device).
- **Bank-sync reconciliation** — imported transactions are now matched against
  your existing **manual or scheduled** transactions (same amount within a date
  window) and **merged** into them instead of duplicated (the bank reference is
  carried over so future syncs recognise the row), imported with the right status
  (booked → **reconciled**, pending → **cleared**, and a pending row settles up to
  its booked form when it arrives), and given a **default payment mode** by account
  type (IBAN → direct debit, card → credit card). Whatever pending transactions a
  bank exposes are imported from the same call; many banks' PSD2 interfaces return
  only booked ones.
- **Bank-sync review** — a dedicated page listing imported transactions that still
  **need a category** (set it inline) and a **duplicate finder** for pairs that
  slipped through, each with **merge**, edit, delete, or **"not a duplicate"** (a
  dismissal that is remembered so the pair isn't surfaced again).
- **Bills, redesigned** — the Bills view now shows **one row per bill** with its
  **last successful payment** and its **next occurrence**, plus a **quick "add a
  bill" form** (name, amount, account, day of month) that creates a monthly
  scheduled outflow in your bills category.
- **Transaction bulk actions** — multi-selection **bulk edit** now covers category,
  payee, payment mode, status and **tags** (add or replace), plus **bulk delete**;
  reachable from the selection bar **and** the right-click menu, with **shift-click**
  range selection in the register.
- **Dashboard Tidy / Reset** — in edit mode, **Tidy** re-packs the widgets into a
  clean, gap-free grid and **Reset** restores the default layout.
- **CI & code review** — CodeQL static analysis runs on every pull request, and the
  end-to-end job builds the app image from a shared layer cache for faster runs.
- **Per-connection sync schedule & cached balances** — each bank connection has
  its own auto-sync **schedule**: the **time of day** and the **weekdays** it runs
  (in your local timezone), instead of a coarse interval. It syncs at most once per
  scheduled day. Account balances on the Bank sync page are also **cached**
  (refreshed at most every 12h) instead of fetched on every visit. Both keep
  CloudBank within PSD2's small per-day access budget.
- **Last-sync status** — each connection shows when it last synced and the outcome
  (ok / partial / error) of that attempt, for both manual and background syncs.
- **Sync history** — each connection keeps a short, expandable history of its recent
  runs on the Bank sync page: time, manual vs automatic, status, and a **per-linked-
  account** breakdown (fetched / imported / reconciled, or the error) — so anyone can
  see why a sync did what it did without reading server logs.
- **Bulk "not a duplicate"** — the duplicate finder can dismiss every surfaced pair
  at once, for when a fresh import flags many look-alikes that are all legitimate.

### Changed

- The background bank-sync timer (`CB_BANK_SYNC_INTERVAL`, now default `1h`) only
  controls how often the job **checks** for due connections; each connection's own
  frequency decides when it actually syncs.

### Fixed

- **CloudBank can be built on Windows.** Two source files whose paths differed
  only in case (`registerFilters.ts` and `RegisterFilters.tsx`) collided on
  case-insensitive filesystems, so imports resolved to the wrong module and the
  web build failed before it started — invisible to Linux CI. The filter model is
  now `registerFilterModel.ts`, line endings are pinned to LF by a
  `.gitattributes`, `npm run typecheck` actually typechecks (it silently checked
  nothing), and `CONTRIBUTING.md` lists the command behind each `make` target for
  contributors without a POSIX shell.

- **Dates now follow your own calendar, not UTC.** The register's **This month /
  This quarter / This year** filters were computed by converting a local date to
  UTC, so east of UTC every preset covered the wrong window — the last day of the
  period was excluded and one day of the previous period leaked in. The same
  conversion decided what "today" meant everywhere else, so a transaction entered
  in the evening west of UTC was pre-filled with **tomorrow's** date, and one
  entered just after midnight east of UTC with **yesterday's**. Every civil date
  is now derived from the local calendar, and the register's midnight roll-over
  waits for *your* midnight rather than UTC's.

- **PSD2 rate limit (HTTP 429).** Bank sync made two transaction calls per account
  (booked + an explicit pending call), doubling usage and tripping the ASPSP's
  "consented multiplicity per day" limit so nothing imported. It now makes a single
  call that already returns whatever pending the bank exposes. A new opt-in
  `CB_BANK_SYNC_DEBUG_PENDING` flag logs a booked/pending breakdown (and, on
  request, the exact provider response) to diagnose banks that return no pending.
  Using it confirmed that **Intesa Sanpaolo exposes only booked transactions**
  over PSD2 — pending charges are unavailable until they book — so the missing
  rows are a bank limitation, not a sync bug. See [docs/bank-sync.md](docs/bank-sync.md).

### Removed

- **The dedicated marketing site.** The Astro one-pager under `site/` and its
  GitHub Pages workflow are gone; CloudBank is presented from
  [easly1989.github.io](https://easly1989.github.io) instead. Nothing in the app
  (server or web) depended on it, so this changes no behaviour — only the
  donation links now point at the consolidated donation page.

### Security

- **Bounded dashboard income/expense window.** The `ieMonths` query parameter was
  clamped only to non-negative; a large value flowed into a slice allocation, so an
  authenticated user could request an enormous window and exhaust server memory. It
  is now capped at the existing 120-month maximum (fixes a CodeQL
  `go/uncontrolled-allocation-size` finding).
- **Dependency automation.** Added a `.github/dependabot.yml` (weekly, grouped
  minor/patch PRs across Go, npm, Docker and GitHub Actions) and documented that
  `CB_SECRET_KEY` should be a strong, high-entropy value.

## [2.0.0 – 3.0.3] — Post-parity releases (2026-07 → 2026-09)

Built on the 1.0 parity base across many point releases: the **2.x** line brought
deep **personalization** and HomeBank **interop** with onboarding polish; the
**3.x** line brought the post-parity push — **automatic bank sync**, security
(**2FA**, scoped API tokens, encrypted secrets), the phone (installable **PWA** +
web push), and **opt-in AI**. (Granular per-tag notes weren't kept; the entries
below summarise the line.)

### Added

- **Scheduled background bank sync** — auto-sync connections are refreshed on a
  timer (`CB_BANK_SYNC_INTERVAL`, default 12h), so transactions arrive without
  clicking "Sync now". A per-connection toggle turns it off, and an Enable
  Banking connection whose consent has expired is skipped (reconnect it to
  resume). Enable Banking connections also show their consent expiry and a
  one-click **Reconnect** that renews it while keeping the account links.
- **Optional secret encryption at rest** — set `CB_SECRET_KEY` to encrypt
  CloudBank's reversible server-side secrets (bank credentials, AI API keys, 2FA
  secrets, the web-push signing key) with AES-256-GCM. Opt-in and backward
  compatible: without it, secrets are stored in plaintext as before; set it and
  each secret is encrypted on its next write.
- **Automatic bank sync** — import transactions straight from your bank,
  de-duplicated and run through your assignment rules, via two
  **bring-your-own-credentials** providers: **SimpleFIN** (worldwide; a ~$15/year
  SimpleFIN Bridge subscription) and **Enable Banking** (EU/EEA + UK via PSD2 — a
  free sandbox to test, your own production application for real accounts).
  Credentials (the SimpleFIN access URL, the Enable Banking application key) are
  stored server-side and never returned to the client; CloudBank never sees your
  bank login. See [docs/bank-sync.md](docs/bank-sync.md).
- **Savings goals** — manual piggy-bank goals with contribute / withdraw, a
  progress bar and an optional target date; included in wallet backup/restore.
- **Bills view** — a "what's due" surface over scheduled transactions, with
  upcoming / due / overdue state and one-click posting.
- **Full-text register search** — search across memo, payee, category and info
  from the register.
- **Two-factor authentication (TOTP)** — optional per-user 2FA with authenticator
  apps (QR enrolment + one-time recovery codes) and a two-step login.
- **Personal API tokens** — scoped, revocable bearer tokens for programmatic
  access (a `Bearer` request bypasses the session CSRF guard); the token secret is
  shown once at creation.
- **Installable PWA** — a web-app manifest, icons and an offline app shell, so
  CloudBank installs to the home screen / desktop.
- **Web push notifications** — opt-in browser push (VAPID; keys stored
  server-side), used for schedule / bill due reminders.
- **Opt-in AI category suggestions** — provider-agnostic, **bring-your-own-key**;
  suggests a category for a transaction from its description. The API key is
  write-only and never returned to the client.
- **Opt-in AI natural-language entry** — type "coffee 3.50 yesterday" and get a
  pre-filled transaction to review before saving (same BYO-key setup).
- **Documented bank-import plugin contract** — a stable CSV/OFX/QIF import-plugin
  contract ([docs/import-plugins.md](docs/import-plugins.md)) plus broader
  debit/credit CSV column mapping.
- **Fully customizable, free-form dashboard** — place and resize widgets anywhere
  on a snap grid (not just reorder); add **multiple instances of any widget** from
  an "Add widget" palette, each with its **own settings** (e.g. two spending
  donuts over different periods); the layout persists per user and stacks to a
  single column on phones. New widget types beyond the standard set: a single
  **account balance** card, a **recent transactions** list, a **key-figure**
  big-number, and a free-text **notes** card. Existing dashboards are migrated
  automatically.
- **Per-account default payment mode** — each account can pre-fill the payment
  mode of new transactions (e.g. Direct Debit for a bank account, Credit Card for
  a card); a chosen payee's own default still takes precedence.
- **Selected-transactions total** — selecting rows in the register now shows the
  selection's net total (plus an income/expense split for mixed selections) in the
  bulk bar, HomeBank-style.
- **Scheduled income/expense summary** — the Scheduled page shows the recurring
  income, expense and net normalized **per week / month / year** at a glance.
- **HomeBank-style dashboard** — pick an account and **Add** opens the full
  transaction modal; the spending donut shows **percentages**; the income/expense
  chart is wider; and the Upcoming panel is split into **Recurring / Future /
  Reminders** tabs, each with post / skip / edit actions.
- **Themes** — an **accent-colour picker** alongside light / dark / auto; the
  light/dark toggle now persists as a user setting (survives a refresh).
- **Collapsible sidebar** (icon rail) and **pinnable, reorderable navigation**
  with a "More" group for unpinned items.
- **Templates** — a dedicated management page (create/edit/delete), and templates
  are offered when entering a transaction instead of appearing as "upcoming".
- **HomeBank `.xhb` export** — download a wallet back to a HomeBank file
  (round-trips with the importer); available from the wallet's backup section.
- **Desktop-style income/expense chart** on the dashboard (diverging bars around
  a zero line) with a selectable period.
- **Smart amount entry** (HomeBank style) — `12.40` and `12,40` are both read as
  decimals; a per-user preference, on by default.
- **Double-click any grid row** — register, budget, currencies and the other
  management grids — to open it for editing.
- A **first-login tutorial** (coachmark tour) — dismissable, shown once per user,
  and restartable from Settings.
- **Brand logo/icon** beside the app name and as the favicon.
- A footer **donation** link (PayPal) and a **HomeBank** credit link.
- An **animated landing site** (Astro) published to GitHub Pages, now featuring
  real app screenshots and a mouse-reactive background.
- CI: a weekly **HomeBank version watch** that opens a compatibility-review issue
  when a newer HomeBank release appears.
- The **Schedules** grid now shows each scheduled transaction's **amount**.
- **Accounts** show both today's balance and a separate **projected future
  balance** (initial balance plus all dated transactions, including future ones).
- A **show / hide future transactions** toggle in the register's filter bar.
- A per-wallet setting to **pre-register scheduled transactions up to N months
  ahead** (HomeBank style, up to 3 months), used by the auto-posting scheduler.

### Changed

- The **wallet switcher** now lists only wallets + "Create wallet"; categories,
  payees, currencies, integrity, backup/restore and `.xhb` export moved under
  **Settings → Wallet**.
- **Import / export moved into Settings → Wallet** (it is wallet-scoped) and is
  no longer a separate sidebar item; the old `/import` route redirects there.
- The wallet **Settings tab is titled after the active wallet** and its sections
  (general, import, backup, danger zone) are grouped behind a section selector so
  they no longer overflow the page.
- **Settings, Import and Preferences** pages now use the full page width instead
  of a narrow centred column.
- **Dates** are rendered everywhere in the user's configured format.
- **Faster initial load** — the app is code-split per route with vendor chunks and
  imports only the chart pieces it uses, so the first download is much smaller.
- Modernized the stack (React 19, Mantine 9, Vite 8, React Router 7, current Go
  dependencies) and internal refactors (per-domain API client, dedicated
  vehicle/tag packages, a SQLite read pool for read-only queries) with no change
  in behaviour.
- Documentation now states parity with **HomeBank** (no fixed version), so it
  tracks current and future HomeBank releases.

### Fixed

- Reports: the **Statistics** pie is larger with a side legend, and the **Trend**
  and **Balance** charts render immediately instead of appearing blank until a
  control is changed.
- The **theme toggle** now switches on the **first click** (previously the first
  click was a no-op when the system theme resolved to "auto").
- **Chart legend and axis text** stay readable in both light and dark themes and
  update correctly when toggling the theme (they no longer keep stale colours).
- **Account balances** are computed from the account's transactions instead of
  always showing the initial balance (often zero).
- The dashboard **quick-add** row no longer stretches wider when a tag is added.
- Italian status labels aligned with the HomeBank desktop wording.

## [1.0.0] - 2026-06-22

The first public release: a self-hosted, web-based personal finance manager with
HomeBank feature parity, shipped as a single Docker container.

### Added

- **Accounts** of every HomeBank type (bank, cash, checking, savings, credit
  card, liability, asset, investment) with per-account currency and flags.
- **Transactions** with 12 payment modes, the cleared/reconciled status
  lifecycle, category **splits**, free **tags**, **internal transfers**
  (including cross-currency), bulk edit and duplicate detection.
- **Register** view with a server-computed running balance, rich combinable
  filters, and a statement **reconciliation** workflow.
- **Scheduled transactions** with automatic posting and a startup catch-up,
  reusable **templates**, and **assignment rules** for auto-categorisation.
- **Budgets** (same-every-month or twelve monthly values) and a full suite of
  **reports** — Statistics, Trend Time, Balance, Budget and Vehicle cost — with
  charts and CSV/PNG export.
- **Import**: native HomeBank `.xhb`, plus CSV (HomeBank dialect and generic
  mapped), QIF and OFX/QFX, through a shared import assistant with duplicate
  flagging, on-import rules and OFX FITID de-duplication. **Export**: CSV and QIF.
- **Multi-currency** with manual rates and online ECB rates via frankfurter.app
  (no API key), with graceful degradation to manual rates.
- **Preferences** (language, theme, date format, start screen, default account),
  a wallet **integrity check** with fixes, **wallet backup/restore** as portable
  JSON, and an admin `VACUUM INTO` hot backup of the whole database.
- **Multi-user**, admin-managed (no self-registration), with first-run setup,
  argon2id passwords, CSRF protection and login rate limiting.
- Responsive UI with light/dark themes and **English + Italian** translations.
- Interactive **API documentation** (Swagger UI) at `/api/docs`.

### Infrastructure

- Single distroless Docker image (amd64 + arm64), SQLite on a `/data` volume.
- CI (lint, race tests, build, Docker smoke, Playwright e2e) and automated GHCR
  publishing (`:latest` nightly, `:main` stable, `:vX.Y.Z` per release).

[Unreleased]: https://github.com/easly1989/cloudbank/compare/v3.0.3...HEAD
[2.0.0 – 3.0.3]: https://github.com/easly1989/cloudbank/compare/v1.0.0...v3.0.3
[1.0.0]: https://github.com/easly1989/cloudbank/releases/tag/v1.0.0
