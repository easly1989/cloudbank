# Using CloudBank, page by page

What each page is for and what it can do. New to CloudBank? Start with
[Getting started](getting-started.md), which sets up a wallet from scratch.

The sidebar groups the pages into **Money**, **Planning**, **Insights** and
**Wallet data**. You can reorder, hide or regroup them under **Settings →
Appearance → Navigation**.
Every page also has a short tour: the **?** in its header plays it.

Beside the **?**, the **eye** turns on privacy mode, for showing CloudBank to
someone without showing your money. Amounts, balances, totals, memos and payees
blur on every page, and charts keep their shapes but lose their figures; dates,
categories and account names stay readable. **Shift+H** does the same. It stays
on, on that device, until you turn it off.

- [Dashboard](#dashboard)
- [Accounts](#accounts)
- [Transactions (the register)](#transactions-the-register)
  - [Adding from your phone](#adding-from-your-phone)
- [Templates](#templates)
- [Tags](#tags)
- [Rules](#rules)
- [Categories, payees and currencies](#categories-payees-and-currencies)
- [Schedules](#schedules)
- [Budget](#budget)
- [Goals](#goals)
- [Reports](#reports)
- [AI insights](#ai-insights)
- [Vehicles](#vehicles)
- [Review](#review)
- [Search](#search)
- [Settings](#settings)

## Dashboard

- **The overview.** The period buttons (Month to All time) set the span for the
  figures at the top: the balance today, what came in, what went out, and the
  share you kept.
- **What the balance adds up.** The balance, here and beside the wallet in the
  sidebar, is the sum of the wallet's accounts. Its label says how many ("4 of 6
  accounts" when some are closed or set to stay out of the totals); click it, or
  the wallet, to see each account's share.
- **What wants your attention.** When something needs you, like an overdue bill
  or bank transactions to review, a card says so and links to it.
- **What the AI proposes.** A [budget proposal](#budget), a
  [savings proposal](#ai-insights) or [unusual transactions](#review) waiting
  for you show under it, short, with a link to the rows. Unusual transactions
  also count in what wants your attention.
- **Widgets.** Below the overview, widgets show your accounts, the budget, where
  your money goes, what is scheduled and more.
- **Customise.** Drag widgets to move them, resize them, hide the ones you don't
  use and add others. **Tidy** closes the gaps; **Reset** restores the default
  layout.
- **Add transaction** records one without leaving the dashboard.

## Accounts

- **The list.** Every account, grouped by type, with three balances:
  - **Reconciled**: what the bank has confirmed, the reconciled transactions;
  - **Today**: that plus what you have entered up to today;
  - **Future**: that plus what is dated ahead.

  Under each name are the bank and the date the account was last reconciled.
  Each type has a band with its subtotals, and the **Total** is at the foot, in
  the wallet's base currency at the latest rates. A balance under the account's
  minimum shows in amber; a minimum of 0 means none is set. The **Closed**
  filter, there once you have closed an account, brings closed accounts back.
- **Opening one.** A click on an account opens its register. Its **⋯** menu
  also has **Edit account**, **Reconcile** (the register, reconciling) and
  **Delete account**.
- **Adding and editing.** **Add account** creates one, and **Edit account**
  opens it in a sheet beside the page. Besides the fields described in
  [Getting started](getting-started.md#4-add-your-accounts), the sheet can
  leave the account out of the totals (here and on the dashboard), the budget
  or the reports, and keeps notes.
- **Valuations.** Asset and investment accounts, such as a house or a
  portfolio, record what they are worth over time under **⋯ → Valuations**.
- **Deleting.** Deleting an account deletes its transactions with it. To stop
  using an account but keep its history, tick **Closed** instead.

## Transactions (the register)

The register lists one account's transactions, newest first, with the running
balance. With more than one account, the account's name at the top of the page
switches between them.

- **Adding.** **Add transaction**, or press **N**, opens the entry sheet. See
  [Getting started](getting-started.md#6-record-transactions).
- **Editing.**
  - Double-click a row to edit it.
  - Right-click a row for more: **Edit**, **Duplicate**, **Mark cleared**,
    **Mark reconciled**, **Save as template** and **Delete**.
  - When you edit a transaction, you can attach files to it, such as a receipt.
- **Status.** Click a row's status to cycle it.
- **Several rows at once.** Tick rows to select them, then **Edit** sets a
  category, payee, payment mode, tags or status on all of them. **Delete**
  removes them.
- **Filters.**
  - The **Filters** button opens a panel beside the register (a sheet on a
    phone) that narrows it by:
    - dates and amounts;
    - payee, category and tags;
    - text;
    - status, or uncategorised only;
    - transfers;
    - whether future rows show.
  - The button shows how many filters are on, and its red **×** clears them
    all. At the top of the panel, each active filter is a chip you can remove
    on its own.
- **Columns.** The columns button chooses which columns show. Drag a column's
  edge to resize it. CloudBank remembers your choice.
- **⋯ (More actions).**
  - **Reconcile.** Tick off a statement against the register. See
    [Getting started](getting-started.md#7-keep-it-matching-the-bank).
  - **Transfer.** Money moving between two of your accounts. It creates one
    entry in each; with different currencies, give the amount sent and the
    amount received. Deleting either entry deletes both.
- **Import** brings in a bank file. See [Importing transactions](import.md).
- **Linked accounts.** When the account is linked to a bank, the header shows
  when it last synced and a **Sync** button. A **to review** button appears when
  the bank sent something that needs you. See [Automatic bank sync](bank-sync.md)
  and [Review](#review).

### Adding from your phone

With CloudBank installed on the phone (**Add to Home screen**, over HTTPS; see
[Reverse proxy and HTTPS](reverse-proxy.md)), a transaction is two taps away.

- **Shortcuts (Android).** A long press on CloudBank's icon offers **New
  expense** and **New income**. Either opens the entry sheet in the wallet you
  last used, on your default account (**Settings → General**), with the sign
  already set.
- **Sharing a notification (Android).** Share the text of your bank's
  notification, or any text, with CloudBank from the share sheet. The entry
  sheet opens:
  - with the AI's **Quick entry** on (**Settings → AI**), the text is read at
    once and the fields fill in;
  - without it, the text shows at the top of the sheet, to copy from while you
    fill it in.

  Nothing is saved until you press **Save**. Only text can be shared: a
  screenshot cannot be read. Many notifications offer **Copy** or **Share** on
  a long press; otherwise copy the text from the bank's app.
- **iPhone and iPad.** iOS offers neither shortcuts nor sharing to installed web
  apps. The **Shortcuts** app gets close: a shortcut with **Open URLs** on
  `https://cloudbank.example.com/transactions?new=1&kind=expense` (or
  `kind=income`), added to the Home Screen, opens the entry sheet the same way.
  To bring text, use `?text=` followed by the text, which **URL Encode** in the
  same shortcut prepares; for example, a shortcut that runs on **Share** with
  **Receive Text** input.

## Templates

A template is a transaction you enter more than once, such as the weekly shop or
the monthly rent, saved to fill in the entry sheet.

- **Saving one.** Right-click a transaction in the register and choose **Save as
  template**. You can also use **Save as template** in the entry sheet's **⋯**
  menu.
- **Using one.** In the entry sheet, the **⋯** menu lists your templates; picking
  one fills in the sheet. The transaction you save remembers the template it
  came from.
- **The Templates page** shows them in two groups:
  - **For quick entry**: the ones you pick yourself, the most used first, with
    how many times each was used in the last twelve months and when last.
    Clicking one opens it in a sheet beside the page, where every field it fills
    in can be changed, tags and info included. Changing a template leaves the
    transactions already made from it as they are. **⋯ → Delete** removes it.
  - **Behind a schedule**: the ones a schedule posts, with how often it comes
    round and when next. They open in [Schedules](#schedules), where the
    schedule and its template are changed or deleted together.
- **Add template** makes one from scratch. A template with splits, or a
  transfer, only has its name and memo changed on this page.

## Tags

Tags are free labels on a transaction, such as *holiday* or *work*. A
transaction can carry several, and reports can group spending by tag.

- **Creating.** Tags are created as you type them on a transaction, or with
  **Add tag** on the Tags page, ready for when you need one. Keep a tag to one
  word if your data goes to or from HomeBank: its file separates tags with
  spaces.
- **The Tags page.** Every tag with the categories its transactions were mostly
  in, how many there were, when it was last used and their amount over the last
  12 months: money in and out together, as the reports by tag add them. Click a
  column's heading to sort by it. Search by name, or show only the tags unused
  in 12 months. A tag opens in a panel beside the page, where renaming it
  renames it on every transaction; **See it in the reports** opens the reports
  on that tag. **Merge** and **Delete** are in the ⋯ menu. Deleting a tag
  removes it from its transactions but keeps the transactions.

## Rules

Rules fill in a transaction from what it says. For example: a payee containing
*Supermarket* gets the category *Groceries*. Each rule is listed as the sentence
it is, with how many of your transactions it matches today.

- **When.** A rule looks in the memo, the payee, either of them, or the tags. It
  matches text that **contains**, **is exactly**, or matches a **pattern**
  (a regular expression), optionally with the same upper and lower case, and
  optionally only in one account. On tags, it matches when any one of the
  transaction's tags does.
- **Then.** The rule sets a category, a payee, a payment mode and/or the info
  field, and can add tags. It only ever adds tags: a transaction keeps the ones
  it has.
- **Use it.** Choose when the rule runs:
  - **When I enter a transaction**, in the entry sheet;
  - **On import and bank sync**. File imports run rules when you tick **Apply
    import rules**.
- **Order.** Rules are tried top to bottom, and the first match wins. Drag them
  by the grip, or use **Move up** and **Move down** in the ⋯ menu (a right click
  on a rule opens it too).
- **The count.** How many of your transactions each rule is the first to match.
  At **0×** it turns amber: a rule that never fires is one to delete, or one a
  rule above is taking every match from, which the rule's line then says.
- **The preview.** While you edit a rule, the sheet shows how many transactions
  it would match, how many of those have no category yet, and the latest ones.
  It is only a preview: nothing changes until you save.
- **Applying.** A saved rule fills in what you enter or import from then on. To
  fill in transactions you already have, use ▶ on a rule (**Apply to its
  transactions**), or **Apply to existing** for every rule at once. Both only
  fill in empty fields and add tags; nothing you have set is overwritten.
- **Rules the AI proposes.** With **Rule proposals** switched on in
  Settings → AI, a box above the rules names up to eight payees you keep
  filing under the same category by hand: at least three of their transactions
  of the last 12 months have a category, four in five of them the same one, and
  no rule decides them yet. Those with the most transactions still without a
  category come first. **Create rule** opens a new rule filled in, the payee
  **is exactly** the name, that category, on entry and on import, with the
  preview of what it would match; nothing is saved until you save. Once saved,
  if some of its transactions have no category, CloudBank offers to fill them
  in. An ignored proposal comes back only when a payee has half as many
  transactions more, another category, or a new payee qualifies.

## Categories, payees and currencies

Three lists in **Wallet data** that the rest of the wallet picks from.

- **Categories.** Two levels: a group, and the subcategories in it. The page
  lists them in two sections, **Spending** and **Income**, each with its
  transactions and its amount over the last 12 months and its share of the
  section; one unused in that time says when it was last used. Search by name,
  show one section, or show only the unused ones. On a computer **Rows / Index**
  switches between rows and an index of the groups in columns, and the page
  remembers your choice. A category opens in a panel beside the page: its name,
  its group (move a subcategory to another group, or choose **None** to make it
  a group of its own), whether it counts in the budget and shows in the
  reports, and what it held in the last 12 months. **Merge** and **Delete** are
  in the panel's ⋯ menu. Reports are built from categories.
- **Payees.** Who you pay and who pays you, each with its transactions, when it
  was last used and its amount over the last 12 months. Click a column's
  heading to sort by it. A payee can carry a default category and a default
  payment, which a new transaction from it starts with. One without a default
  category shows the category it usually gets ("Usually Groceries") when that
  holds at least half of its transactions; **Use it** makes it the default.
  Search by name, or show only the payees without a default category or unused
  in 12 months. A payee opens in a panel beside the page, which offers the same
  suggestions for the category and the payment; **Merge** and **Delete** are in
  its ⋯ menu.
- **Currencies.** The currencies this wallet can use, the base first. Each
  shows its rate against the base ("1 $ = 0,8807 €"), where the rate came from
  (the ECB and its date, or **Typed by you**) and how many accounts are kept in
  it. The ECB's rates arrive every day, and **Update rates now** fetches them at
  once. **Add currency** picks one from the list, and its rate comes straight
  away; for one the ECB does not publish, the panel stays open for you to type
  it. A currency opens in a panel beside the page: its rate (with the other
  way round), and how its amounts look: symbol, before or after, decimal mark,
  thousands separator and decimals, with a preview. In its ⋯ menu, **Make it the
  base currency** works every other rate out again against the new base, so
  amounts keep their value; **Delete** waits until no account is kept in it.

The entry sheet can also create a category or a payee as you type one it does
not know.

## Schedules

Schedules are transactions that come round on their own: rent, a salary, a
subscription, the bills. The page has two views, **Calendar** and **All
schedules**, and **All / Out / In** shows everything, only money going out, or
only money coming in.

- **Calendar.** The month, with each occurrence on the day it falls and where it
  stands:
  - **Not registered**: the schedule has not posted it yet;
  - **Registered**, **Cleared** or **Reconciled**: the status of the transaction
    it became, even when it was registered months ahead;
  - **Overdue**: its date has passed and it is not registered.

  The figures above it give what is still to pay this month (everything not yet
  reconciled), what is overdue, and what is coming in. Transfers between your
  own accounts show on the calendar but are not counted as bills or income.
- **Needs you.** Beside the calendar: occurrences that are overdue, or due within
  the week and not set to post themselves. **Register** posts one as the
  schedule describes it, and **Skip** passes over it. Under it, **Next up** lists
  what comes after today.
- **Add to calendar.** In the calendar view, at the end of its bar (the calendar
  icon on a phone): the due dates in your phone's calendar app.
  - **Create the address** makes a private address for you and this wallet. A
    calendar app subscribed to it shows every occurrence, from three months back
    to twelve ahead, on its day with its name and amount, and picks up changes on
    its own (most apps check every few hours). It never shows a balance.
  - To subscribe:
    - **iPhone and Mac**: tap **Subscribe**, or open Settings ›
      Apps › Calendar › Calendar Accounts › Add Account › Other › Add Subscribed
      Calendar and paste the address.
    - **Google Calendar**: on a computer, Other calendars › + › From URL, and
      paste the address. It then shows in the Google Calendar app on Android and
      iPhone.
    - **Outlook**: Add calendar › Subscribe from web, and paste the address.
  - **Download .ics** saves the same calendar as a file, to import once.
  - Anyone with the address sees your due dates. **Regenerate the address** if
    it reached someone else: the old one stops working and calendars have to be
    subscribed again. **Turn off** stops it altogether.
- **Opening an occurrence.**
  - One still to register opens in a sheet, where you can change the amount, the
    date or the status before registering it (a bill is rarely the same twice),
    with the months before it for comparison.
  - One already registered opens the register on its row, which is where it is
    reconciled.
- **All schedules.** One row per schedule: the amount, how it repeats, when it
  is next due (and how far ahead it is registered), its mode, and where this
  month's occurrence stands, with what it adds up to in a year under the amount.
  The figures give what the schedules take out and bring in over the next twelve
  months, and per month under them; a schedule with a limit counts only the
  occurrences it has left. Under each name, who it pays (or **No payee**) and the
  account. Click a row to edit it; its **⋯** menu posts now, skips, edits or
  deletes it.
- **Found in your transactions.** Payments that come round with no schedule for
  them: the same payee, a similar amount (within 10%), every week, month, three
  months or year, still going. Each shows how often, how many times since when,
  the usual amount and what it adds up to in a year, the costliest first; it sits
  above **All schedules** and under **Needs you** beside the calendar.
  - **Create schedule** opens the sheet filled in from it: the payee, the
    amount, the account, how often and the next date.
  - **Ignore** stops offering that payee at that cadence in this wallet.
  - A payee that a schedule already pays is not offered, and neither are
    transfers or void transactions.
- **Subscriptions the AI points out.** With **Subscription proposals** switched
  on in **Settings → AI**, the AI box under the figures lists up to five
  schedules worth a look. CloudBank has no way to know whether you use a
  service, so it goes by what the bank shows:
  - **Raised**: the last two payments to the payee, a period apart, are at
    least 5% over the amount the schedule saves. **Update** opens the schedule
    with the latest amount filled in.
  - **Double**: a second schedule to the same payee, or of the same amount
    just as often as an earlier one. **Open** opens the second, where its
    delete button is.
  - **Not paid**: a schedule that does not post itself, whose payee has not
    been paid for two of its periods. **Open** opens it.
  - Nothing changes until you save or delete the schedule, which takes the row
    off the proposal. **Later**, **Ignore** and **Why?** work as for
    [budget proposals](#budget); an ignored proposal comes back when a new
    schedule turns up or an amount moves by more than a fifth.
  - It is made monthly, like a budget proposal, and only looks at schedules in
    the wallet's base currency.
- **Adding and editing.** **New schedule** opens a sheet beside the page: the
  name, the amount, the payee, the account, how often and from when, and whether
  it posts itself. **More details** holds the category, memo, payment mode, the
  weekend handling, **Post days early** and a limit on the number of occurrences.
- **The payee is required** for every schedule except a transfer.
  - Schedules saved without one, such as imported ones, are counted in a banner
    at the top of the page. **Complete them one by one** opens each in turn.
  - Each one still registers itself in the meantime.
  - When you set or change the payee of a schedule that already registered
    transactions without one, the sheet offers to give it to those transactions
    too. Transactions that already have a payee keep it.
- **Weekend handling.** When a date falls on a weekend, keep it, move it to the
  Friday before or the Monday after, or skip it.
- **Mode.**
  - **Post automatically** records the transaction on its date, or some days
    early with **Post days early**.
  - **Remind** records nothing: the occurrence waits under **Needs you**.
- **Posting months ahead.** The wallet setting **Pre-register scheduled
  transactions** posts upcoming ones up to three months in advance, the way
  HomeBank does. It is under **Settings →** *your wallet*.

## Budget

A budget is how much you plan to spend in each category, set against what has
actually gone.

- **The period.** **Month** or **Year**, and ‹ › to step back or ahead. **⋯**
  exports the page as CSV.
- **The answer first.** What you have spent of what you planned, what is left,
  the days to go, and how many categories are past their plan. The bar under it
  is the whole budget.
- **A line per budget.** Planned, spent and left, largest plan first, with a bar
  each. A line past its plan shows in amber. The tick on the bars is where today
  falls in the period: a bar past it is spending ahead of plan.
  - **A budget on a parent** (Food) covers its subcategories that have no budget
    of their own; one with its own budget (Food › Restaurants) is a line apart.
  - **Still to come.** A transaction entered but dated after today counts
    against the plan, since the money is committed, but shows lighter on the
    bar and as "+ … to come" under what is spent.
  - **Not in the budget.** Spending in categories with no budget is listed
    apart, with **Add to budget** on each. It is not over anything and is not
    added into the plan.
  - **Expected income.** Budgets on income categories, when there are any, show
    in a group of their own: what has come in and what is still to come.
- **Editing a budget.** Click a line, or **Add to budget**, to open the sheet
  beside the page.
  - **The same every month** is one amount; **Month by month** is twelve, for
    spending that changes with the seasons.
  - **Every year**, or **only** the year on the page, for a year that costs more
    or less. The other years keep their plan.
  - **The last 12 months** shows what the category took each month against the
    plan, and **Plan … a month** sets the average, rounded to 5.
  - The line's **⋯** also opens its transactions in the reports, or removes it
    from the budget.
- **Categories and accounts** set to stay out of the budget are not counted.
- **Budgets the AI proposes.** With **Budget proposals** switched on in
  **Settings → AI**, the AI box above the lines proposes up to five budgets
  from the six complete months before this one: a category spent on in at
  least five of them with no budget, or a budget gone over, or not reached, in
  at least four. CloudBank works out each amount, the median of the months
  rounded to 5; the model only says why in two or three sentences.
  - **Apply** on a row opens the sheet filled in with that amount, the same
    every month and every year. Nothing is saved until you save it there,
    which takes the row off the proposal.
  - **Later** hides the proposal for a week. **Ignore** puts it away: it comes
    back only when an amount moves by more than a fifth, or a new category
    turns up. **Why?** shows each month and the median.
  - A new proposal is made on the 1st of the month, at 07:00 in your time
    zone, and at once when the switch is turned on. It is yours alone, on the
    wallets the AI may work on.

The dashboard's **Budget** widget shows this month at a glance, and the overview
says when a category has gone past its plan. A budget proposal shows there too,
short, with **See in Budget**.

## Goals

A goal is money you are putting aside for something, such as a holiday or a
rainy-day fund. It is a note about money, not money: nothing here moves a
balance, and the account a goal is kept in is only a reference.

- **The figures.** What is set aside, across the goals still open; **To put
  aside each month**, the monthly shares together, against what you put in
  lately (in amber when it falls short); and **Free to spend**, the wallet's
  balance less what is set aside.
- **A row per goal.** Saved, the target and a bar, soonest date first.
  **Getting there** says what a month makes its date, in amber when the last
  three months fall short, and when you would get there at that pace. A goal
  with no date says when you would get there, or that nothing went in lately.
- **Putting money in.** **Put in** opens the sheet beside the page, starting
  from this month's share; **Take out** is the same sheet the other way. Money
  that reaches the target can close the goal with it.
- **Reached goals** wait in a band of their own, still counted as set aside,
  with **Close** on each. The overview reminds you of them.
- **The history.** A closed goal, reached or given up on from its **⋯**, moves
  to the history under the table and stops counting as set aside. Its money
  stays as it was; **Reopen goal** brings it back.
- **Editing a goal.** Click its row: its name, target, date, the account it is
  kept in and a note, and every movement in and out, each deletable.
- **Goals the AI proposes.** With **Goal proposals** switched on in
  Settings → AI, a box under the figures names up to five goals to look at,
  by the page's own arithmetic over the last three months:
  - a dated goal whose pace falls short of its monthly share: **Put in** opens
    the sheet with this month's share filled in;
  - a share more than the wallet kept a month in those months: **Move the
    date** opens the goal with the month its pace gets there;
  - a goal with no date: **Set the date** opens it with the month its pace
    gets there.

  Nothing is saved until you save the sheet. **Later**, **Ignore** and
  **Why?** work as for budget proposals; it is made monthly, and the model is
  told never to say where to keep or invest the money.

Outside the page, the **Accounts** page and the register say how much an account
holds for goals, in amber when it holds less, and the dashboard can carry a
**Goals** widget from **Customise**.

## Reports

Reports answer four questions, one per tab. Pick the period at the top (Month to
All time) and step through the periods with the arrows.

- **Spending: where did the money go?**
  - Spending or income over the period, by category, payee or tag.
  - Each line is compared with the previous period.
  - Click a line for its transactions, and open them in the register.
  - Transfers between your own accounts are left out unless the filters say
    otherwise.
- **Cash flow: what came in, and what went out?**
  - One bar per day, week, month, quarter or year.
  - What was kept in each, and the running total.
- **Balances: what do my accounts hold, and what will they?**
  - The total balance over time, for all accounts or the ones you pick, with
    what is scheduled.
  - A warning when an account went under its minimum balance.
- **Vehicle: what does a car cost?**
  - The cost per kilometre and the fuel consumption, fill by fill. See
    [Vehicles](#vehicles).

**Filters** narrows every tab with the same filters as the register: payee,
category, tags, amounts, text, status and transfers. The Balances tab also picks
which accounts to add up. **Saved views** keep a tab, its period and its filters under a
name, to come back to. Each tab downloads its figures as CSV and its chart as
PNG.

## AI insights

Reports your own AI writes on the wallet's numbers. The page is in the
sidebar only while the AI is set up in **Settings → AI** with **Monthly
reports** switched on, for a wallet the AI may work on.

- **They come by themselves.** Last month's report is written on the 1st, at
  07:00 in your time zone, for every wallet the AI may work on. Under **Monthly
  reports** in Settings → AI, two more can be ticked: **every Monday, the week
  before** (off at first) and **in January, the year before** (on). If the
  server was off at 07:00, the report is written when it is back, while the
  period is still the latest. A wallet with nothing in the period gets none,
  and a period that already has a report, even one you asked for, gets no
  other. The [notification](notifications.md) **AI report ready** says when
  one is written, and opens it.
- **Generate now** writes the report of the month picked beside it: the last
  complete month, or any of the twelve before.
- **The latest report**, or the one a notification opened, is shown in full,
  in the AI box: the frame CloudBank puts round everything the AI wrote.
  **Why?** opens the numbers it was given: a month against the one before and
  the six-month average, a week against the week before and the six-week
  average, a year against the year before. CloudBank works them out, the model
  only writes the text. The thumbs say whether it helped.
- **Earlier reports** are listed under it, named by their month, week or year;
  **Read** opens one.
- **Open proposals**: a [budget proposal](#budget), a
  [subscription proposal](#schedules), a savings proposal, a
  [goal proposal](#goals) or a [rule proposal](#rules) waiting for you, with
  its rows; **Apply** and **Set budget** open the budget sheet on Budget,
  **Update** or **Open** the schedule on Schedules, **Put in** and the dates the
  goal on Goals, **Create rule** a new rule on Rules.
- **Savings the AI proposes.** With **Savings proposals** switched on in
  Settings → AI, up to three categories you spent more on lately: the last
  three complete months at least a fifth, and 10 a month, over the nine
  before. The title says what going back to before would keep a month.
  - **Set budget** opens the budget sheet on Budget at the earlier level,
    rounded to 5; nothing is saved until you save it there.
  - A category the budget proposal already has is left to it. **Later**,
    **Ignore** and **Why?**, each month against the two averages, work as for
    budget proposals.
  - It is made monthly, after the budget proposal, and shows short on the
    overview with **See the details**.
- **Yours alone.** In a shared wallet the others see none of your reports.

At this month's request limit, **Generate now** asks before going past it. A
report that would come by itself is skipped instead, and not written after the
limit resets; the bell says so once, with a link to Settings → AI.

## Vehicles

What each car, motorbike or van costs to run. A row per vehicle shows its last
12 months:

- what its fuel cost, and how many fills;
- the kilometres driven, and what one cost;
- the litres per 100 km;
- the last fill: when, and the odometer then.

Click a row to edit the vehicle's name, plate and notes, next to the same
figures and its five latest fills. **Report** opens the **Vehicle** tab of the
Reports page on it, fill by fill. The button gives way first when the page is
narrow; ⋯ and a right click on the row have it too. Deleting a vehicle says
how many payments it was linked to: they stay in the register, with no vehicle.

To get a vehicle's fuel onto the page:

1. **Add the vehicle** with **Add vehicle**. A name is enough.
2. **Record each fill-up** as an ordinary transaction and pick the vehicle in
   the entry sheet's **Vehicle** field, under **More details**. The field shows
   once you have a vehicle.
3. **Write the readings in the memo**, the way HomeBank does:
   - `d=` the odometer reading;
   - `v=` the volume;
   - `p=` the price per unit, optional.

   For example, `d=45210 v=38.5`. A dot or a comma works as the decimal
   separator.

Consumption is worked out between full fills. A fill-up without `v=` counts as
partial: its distance carries on to the next full fill.

## Review

Review collects the imported, bank-synced and mail-read transactions that need
you:

- **Unusual transactions.** With **Unusual transactions** switched on in
  Settings → AI, a box on top lists the expenses of the last 30 days that look
  wrong, among those you did not type in yourself (from the bank, a mail, a
  schedule, an import or another member):
  - an amount at least twice the payee's usual one (the median of at least four
    expenses in the year before) and 20 above it;
  - a new payee with an amount above 95% of the wallet's expenses in the year
    before, and at least 50;
  - the same payee charged the same amount twice within 3 days on one account.

  **Open in the register** opens the transaction; **It's fine** puts it away
  until its amount changes. A double charge leads to its pair among the
  possible duplicates with **See the pair**, and **Not a duplicate** puts both
  away. Each new one reaches the bell as **Unusual transaction**, opening it in
  the register; turning the switch on looks at the last 30 days without telling.
- **Needs a category.** Transactions that arrived without a category. Set one
  and they leave the list.
- **Possible duplicates.** Pairs that look like the same movement entered twice,
  one from the bank and one by hand.
  - **Keep this** merges the pair into the side you chose.
  - **Not a duplicate** keeps both and stops asking.
- **Not confirmed by the bank.** Transactions read from a
  [bank mail](bank-mails.md) that the bank has not booked five days on. Often
  the real charge differs: a petrol station that holds 100 and takes 40, a
  hotel, a payment in another currency. **Merge** them into the bank's row, or
  delete them.

Review has no place in the sidebar. You reach it from the **to review** button in
an account's register, and from the dashboard's list of what wants your
attention.
The link above its title takes you back there: to the register, or to the
dashboard. When nothing is left to review, the page says so, with a button back.

## Search

**Search** at the top of the sidebar, or **Ctrl+K**, searches the whole wallet:
memos, payees, categories and tags, across every account. Picking a result opens
its account's register, searching for what you typed.

## Settings

The gear at the foot of the sidebar opens Settings. Its sections:

| Section | What is there |
| --- | --- |
| **General** | Language, date format, start screen, default account, tours; which fields the entry sheet shows |
| **Appearance** | Theme and accent, the balances shown, account balances in the sidebar, the footer; the sidebar's navigation |
| *Your wallet* | Name, owner, pre-registered schedules, the bills category the dashboard's Bills widget lists |
| **Security** | Two-factor sign-in, API tokens |
| **Notifications** | Which events reach you, in the bell, by push on this device, by email, in Matrix, Telegram, Discord or Slack, through ntfy or Gotify, or through a webhook ([the guide](notifications.md)); the bell itself sits in every page header |
| **Bank sync** | Bank connections ([Automatic bank sync](bank-sync.md)) |
| **Bank mails** | The bank's notification mails, read from one folder of a mailbox ([the guide](bank-mails.md)) |
| **AI** | The optional AI, with your own key: the provider; which jobs it does (monthly reports, budget, subscription, savings, goal and rule proposals, unusual transactions, category suggestions, quick entry, reading [bank mails](bank-mails.md)), each saying what it sends; on which wallets; the monthly request limit; the moving colours of the AI box; and the last 90 days of what was sent, word for word. See [the AI guide](ai.md) |
| **Import & export** | Imports ([Importing transactions](import.md)), exports, backups and a database check |
| **People** | Administrators only: the people who can sign in |
| **About** | The version, the licence and the source code; for administrators, whether a newer CloudBank is out and the switch for the daily check ([Upgrading](backup.md#upgrading)) |
