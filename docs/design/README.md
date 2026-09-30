# The design spec, as numbers

The UI is built against one design artefact: the **"CloudBank restyle — style tile"**
Artifact. Its seven boards are the target — foundations, dark, the register, the
overview, settings, the secondary pages, and entering & deciding.

A screenshot of a mockup is not a specification. You cannot read a column width,
a font weight or a row's grid template off one, and building "towards" a picture
produces something that looks vaguely right and is wrong everywhere. So the
boards are extracted as **measured data** and the UI is built to those numbers.

## The files

`extract-spec.mjs` renders each board and dumps every element that paints
something: its text, position, size, font size and weight, whether it is in the
money face, colour, background, border, radius, padding, gap, and — for rows —
the grid template that puts the columns where they are.

```bash
# 1. export the artefact's boards as standalone HTML into a folder
# 2. serve it
python -m http.server 8123
# 3. extract
node docs/design/extract-spec.mjs http://127.0.0.1:8123
```

One JSON per board lands beside the script. Re-run it whenever the artefact
changes: the diff then says exactly what moved, which is the point of keeping
them in the repo rather than in someone's screenshots folder.

## How to use them

Build to the numbers, then **measure the built page and compare it back**. "It
looks close" is not a check — every time that was the check on this project, the
result was wrong in ways nobody could name until the numbers came out.

Two things the extraction cannot tell you, so read the artefact itself as well:

- **The canvas notes** — the yellow stickies — carry the reasoning behind the
  layout, and the HTML export drops them. They live in the artefact's
  `project/canvas.json`.
- **Annotations are not UI.** Each board has explanatory prose around the mock
  (the line under the register, the paragraph beside the columns panel). Those
  describe the design; they are not elements to build.

## What the app has that the design does not

The tile is a design for the shape of the app, not an inventory of its features,
so a few things in CloudBank have no counterpart on a board — the sidebar search
row, the register's reconcile and transfer workflows, several dashboard widgets.
Where that happens it was a decision, not an oversight; see #449 for which ones
and why. Adding to that list is fine, but say so rather than letting the two
drift apart quietly.

Added since:

- **The collapse-sidebar button in the sidebar foot** (#465). The overview board
  puts only the gear beside the user row; the app keeps a 34px button to fold
  the sidebar into a rail, so the user row is 162px wide instead of 198.
  `e2e/design-size-audit.mjs` checks that row's height only, for this reason.
- **Page tours** (#421). The boards draw no help at all. Each page with a tour
  has a **?** as the first of its header actions: a default icon button, 44px on
  the register and the overview and 40 elsewhere, like its neighbours. The two
  settings sections with tours (General, Data) put it beside the section title.
  The first time a page is opened, a 320px card in the bottom-right corner
  offers its tour. It is not a dialog, and it sits above the page but below any
  modal.
- **The entry sheet's fields are the reader's to arrange** (#469). The Entering
  and deciding board draws Date · Account, Memo, Category · Payee. By default the
  app instead shows what a transaction needs: Date · Account, Memo, Payment ·
  Category, and the status as a row of icons. Payee waits under More details
  with the rest. Settings → General → Transaction sheet moves any field either
  way, and names the default a new entry takes when the date or the account is
  out of view. The board's "Save and add another" gains a joined toggle on its
  left, which keeps every field for the next entry and relabels the button
  "Save and keep". The board's "Enter saves ↵" line is gone. Each foot button
  instead shows its own key after its label: ↵ on Save (save and close) and ⇧↵
  on the other (save and start another). The keys are hidden on a touch screen.
  This makes both buttons wider than the board draws, so the audit checks their
  height and type only. It still measures the amount, a paired field (Date) and
  a full-width field (Memo) against the board.
- **The demo build's band and notice** (#420). Only the `:demo` image has them.
  A yellow band opens every page, with "What's different here?" at its right.
  On the dark theme that link takes the band's own text colour, underlined,
  because the accent blue falls to 3:1 there. The band opens a notice, which also
  opens by itself on the first visit. The login card becomes a single "Start the
  demo" button. Settings loses Security. Integrations becomes Bank sync, with no
  AI. The Data section keeps the downloads but not the restore. The bank sync
  page shows the pretend bank's panel in place of the three providers.
- **Reconciled lines only under a status filter** (#474, #480). The register
  board draws one "reconciled up to here" line in the unfiltered ledger, where
  each row's status already says what the line would. The app draws lines only
  while the status filter hides reconciled rows ("Not reconciled", "Cleared",
  "No status", or "no flags"); a date or text filter leaves the reconciled rows
  it keeps on screen, so it draws none. Each run of hidden reconciled rows
  between two visible rows becomes one line, where the run sits in the ledger,
  with its date (or date range) and how many rows it stands for. The last line
  reads "everything reconciled up to here" when every older transaction of the
  account is reconciled. Lines only appear while the register runs newest first.
- **The entry sheet's foot stays in view** (#474). A split of several lines can
  make the sheet taller than the screen. The foot is sticky at the bottom of the
  sheet, on the sheet's own background, and the sheet shows a thin scrollbar in
  place of a hidden one.
- **The reports** (#488–#493). No board draws them, so they follow the tile's
  rules rather than a mock of their own:
  - **One frame for every tab.** A period bar (Month, Quarter, Half-year, Year,
    All time, then ‹ period ›), a Filters button that opens the register's
    filters (beside the page on a desktop, from the bottom on a phone), and a
    **⋯** for saved views and the two downloads. Filters that are on show as
    chips under the bar. Everything is in the URL. The tabs are Spending, Cash
    flow, Balances and Vehicle. Transfers between one's own accounts are left
    out unless the filters include them.
  - **The answer first.** Each tab opens with its figures — a label, the figure
    in IBM Plex Mono (40px for the main one, 28px beside it; 32 and 22 on a
    phone), a line of context — before any control.
  - **No pies, and never colour alone.** Spending is a ranked list: a dot, the
    name, the amount, a bar against the largest, a tick where the period before
    stood, and the share and change in words. After seven rows the rest become
    "Other (n)". Every chart has its figures beside it, in a list or a table.
  - **Colours.** Categories take the tile's four (#C2762B #4B63C7 #2F7D63
    #8A5BA8; dark #D8955A #7C8FDD #55A98A #B08CCC) and three drawn to match
    (#B0476B #3E8CA3 #7C7A2A), with #8B93A1 for "Other". Money in and out keep
    the amounts' pair, attention its amber, and blue is only for what can be
    clicked. The dashboard's spending widget uses the same set
    (`web/src/chartPalette.ts`).
  - **Honest charts.** Axis labels are never turned; balances are drawn in
    steps; nothing after today is drawn as zero, and a period still running
    says "so far". A chart whose axis cannot start at zero uses points, not
    bars.
- **Bank sync in Settings, Review from the register** (#504, #505). The
  settings board already names the section "Bank sync & AI"; the app now puts
  the whole bank sync there instead of on a page of its own, and the sidebar
  loses its Banking group. Neither board draws what replaces the links: the
  register of an account linked to a bank gets a row above its balances — when
  it last synced, a Sync button, and an amber "N to review" when that account
  has rows waiting — and Review opens filtered to that account.
- **Settings › About, and a footer that can be turned off** (#513). The
  settings board has seven sections; the app adds an eighth, About, last and for
  everyone: the version, the licence in a sentence, and the source, API docs,
  donation and HomeBank links. It exists so that the switch the app adds to
  Appearance, "Show the footer", hides nothing the AGPL needs in reach. On a
  touch screen the footer at the end of the page is one 44px line, the version
  and licence with a "Links" toggle that opens the links one per row; the fixed
  bar a mouse gets is unchanged.
- **Accounts on a phone** (#514). No board draws the accounts page at phone
  width. There each account is one line: the name over its bank and share on
  the left, the amount on the right, never wrapped, and a ⋯ menu (Edit,
  Valuations for assets and investments, Delete) in place of the three icons.
  A tap on the row opens the account. The name gives way first.
- **Bills became the Schedules page's calendar** (#546). The secondary pages
  board draws Bills as a list, one row per bill with its next date. That list
  showed each schedule's next unregistered occurrence, so a reader who registers
  months ahead saw the bills after those months. The app merges Bills into
  Schedules, one menu entry, with two views:
  - **Calendar**: the month Monday first, each occurrence on its day with its
    state (not registered, registered, cleared, reconciled, overdue) as the
    status picker's icons, never colour alone. The figures open the page as on
    the reports (still to pay 40px, overdue and coming in 28px). A 320px
    "Needs you" column beside it registers or skips; under 1000px of content it
    drops below the calendar, under 760px the calendar takes the phone's form,
    and on a phone the month is a small grid with an icon under each day,
    followed by the month's list.
  - **All schedules**: the schedules themselves, one row each in the register's
    band and row sizes.

  An occurrence still to register opens in a sheet built like the entry sheet
  (396px on the right, from the bottom on a phone); a registered one opens the
  register on its row, which the cursor lands on and marks with the arrival
  tint until it moves. The schedule form moved from a dialog into the same
  sheet, which the other secondary pages will share.
- **Categories carry their figures** (#552). The secondary pages board draws
  the categories as a plain list. The app, to an approved mockup, gives each
  its transactions, its amount and its share of the section over the last 12
  months, in two sections, Spending and Income, full width:
  - **Rows**: the register's card, band and 46px rows; a group folds its
    subcategories away, and "+ Subcategory" shows on its row under the pointer.
    Under 960px of content the share column goes.
  - **Index**: each section under a heading with its total, the groups in
    columns (`columns: 3 300px`), each with a 4px bar and its subcategories.

  Rows / Index is a desktop choice, kept in the preferences; a phone has a card
  per section, a band per group and a row per subcategory. A category opens in
  the 396px sheet, where a subcategory can move to another group. The mockup's
  "Show them in the register" became "See it in the reports": the register is
  per account, and the reports filter by a category across all of them.
- **Payees carry their figures** (#554), to an approved mockup, in the
  Categories page's family: one row per payee in the register's card, with its
  default category, transactions, last use and amount over 12 months, sorted by
  amount and by any column's heading. A payee with no default shows the
  category it usually gets when that holds at least half of its categorised
  transactions, and "Use it" under the pointer makes it the default. The sheet
  adds the default payment, which the old dialog neither showed nor kept.
  Under 900px of content the last-use column goes.
- **Tags carry their figures** (#556), to an approved mockup, in the Payees
  page's family: one row per tag, with the two categories its transactions were
  mostly in, transactions, last use and net amount over 12 months, sorted the
  same way. The board has no Add for tags; the app has one, which makes a tag
  before any transaction carries it (`POST /tags`). Renaming happens in the
  sheet, not in a field on the row. Under 900px of content the last-use column
  goes.
- **Currencies carry their sources** (#558), to an approved mockup; the board
  has no currencies page. One row per currency, the base first: its rate read
  as "1 $ = 0,8807 €", where it came from (ECB and date, or "Typed by you" in
  yellow) and the accounts kept in it. The sheet edits the rate and the format,
  which the API always allowed and the old page never showed. Symbols are set
  apart with Unicode isolates, so a right-to-left one keeps the line in order.
  Under 900px of content the source column goes.
- **Templates come in two groups** (#560), to an approved mockup; the board has
  no templates page. The ones kept for quick entry show how often each was used
  over 12 months — a transaction saved from a template now records it — and
  open in the sheet with every field, tags and info included (the old dialog
  dropped both on save). The ones a schedule posts show its cadence and open
  that schedule in Schedules (`?schedule=ID`); they are not deleted here, and the
  server refuses to (`409 scheduled`), since deleting one used to delete its
  schedule with it. Under 900px of content the account column goes.
- **Accounts carry three balances** (#564), to an approved mockup; the board has
  no accounts page. One card in the register's style: Reconciled · Today ·
  Future, a band per type with its subtotals and the total at the foot, in the
  base currency. The list now returns `reconciledBalance` and `lastReconciled`.
  A click opens the register, not the edit form; editing is under ⋯, in the
  sheet, which shows and sends the exclusions and notes the old dialog wiped.
  The group and the website are not edited on this page and are sent back as
  they are. Under 900px of content the reconciled column goes.
- **Rules read as sentences** (#566), to an approved mockup and the board's
  drawing of them: "When the payee contains `Supermarket`" over "● file it under
  Food › Groceries", the dot red for spending and green for income, with the
  count on the right ("72×"). The board's rows are 60px, and so are these, in
  the register's card with the account, when the rule runs, ▶ (apply this rule)
  and ⋯. The count is how many transactions the rule decides, the first to match
  each; at 0× it is amber, and when a rule above takes every match the line says
  so. The board does not draw ▶, the order controls (the grip, Move up / down,
  a right click) or tags: the user asked for them. Under 900px of content the
  "Used on" column goes.
