# Using CloudBank, page by page

What each page is for and what it can do. New to CloudBank? Start with
[Getting started](getting-started.md), which sets up a wallet from scratch.

The sidebar groups the pages into **Money**, **Planning**, **Insights** and
**Wallet data**. You can reorder, hide or regroup them under **Settings →
Appearance → Navigation**.
Every page also has a short tour: the **?** in its header plays it.

- [Dashboard](#dashboard)
- [Accounts](#accounts)
- [Transactions (the register)](#transactions-the-register)
- [Templates](#templates)
- [Tags](#tags)
- [Rules](#rules)
- [Categories, payees and currencies](#categories-payees-and-currencies)
- [Schedules](#schedules)
- [Budget](#budget)
- [Goals](#goals)
- [Reports](#reports)
- [Vehicles](#vehicles)
- [Review](#review)
- [Search](#search)
- [Settings](#settings)

## Dashboard

- **The overview.** The period buttons (Month to All time) set the span for the
  figures at the top: the balance today, what came in, what went out, and the
  share you kept.
- **What wants your attention.** When something needs you, like an overdue bill
  or bank transactions to review, a card says so and links to it.
- **Widgets.** Below the overview, widgets show your accounts, the budget, where
  your money goes, what is scheduled and more.
- **Customise.** Drag widgets to move them, resize them, hide the ones you don't
  use and add others. **Tidy** closes the gaps; **Reset** restores the default
  layout.
- **Add transaction** records one without leaving the dashboard.

## Accounts

- **The list.** Every account with its balance, grouped by type. **Show closed**
  brings back accounts you have closed.
- **Adding and editing.** **Add account** creates one, and an account's **Edit**
  action changes it. The fields are described in
  [Getting started](getting-started.md#4-add-your-accounts).
- **Valuations.** Asset and investment accounts, such as a house or a
  portfolio, record what they are worth over time under **Valuations**.
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
  - The filter button narrows the register by:
    - dates and amounts;
    - payee, category and tags;
    - text;
    - status, or uncategorised only;
    - transfers;
    - whether future rows show.
  - Active filters show as chips you can remove one by one. On a phone, the
    button shows how many are on.
- **Columns.** The columns button chooses which columns show. Drag a column's
  edge to resize it. CloudBank remembers your choice.
- **Privacy.** The eye button hides names and amounts, for when someone is
  looking over your shoulder.
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

## Templates

A template is a transaction you enter more than once, such as the weekly shop or
the monthly rent, saved to fill in the entry sheet.

- **Saving one.** Right-click a transaction in the register and choose **Save as
  template**. You can also use **Save as template** in the entry sheet's **⋯**
  menu.
- **Using one.** In the entry sheet, the **⋯** menu lists your templates; picking
  one fills in the sheet. Schedules can also start from a template.
- **The Templates page** lists them, and adds, renames or deletes them. Deleting
  a template leaves the transactions made from it alone.

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
*Supermarket* gets the category *Groceries*.

- **Match.** A rule looks in the memo, the payee, or either. It matches text that
  **equals**, **contains**, or matches a **regex**, optionally case-sensitive,
  and optionally only in one account.
- **Sets.** The rule sets a payee, a category, a payment mode and/or an info
  field.
- **Applies.** Choose when the rule runs:
  - **On manual entry**, as you type in the entry sheet;
  - **On import**, for files and bank sync. File imports run rules when you tick
    **Apply import rules**.
- **Order.** Rules are tried top to bottom, and the first match wins. Drag them
  to reorder.
- **Test rule** shows how many transactions a rule would match.
- **Apply to existing** runs the rules over transactions you already have.

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
- **Opening an occurrence.**
  - One still to register opens in a sheet, where you can change the amount, the
    date or the status before registering it (a bill is rarely the same twice),
    with the months before it for comparison.
  - One already registered opens the register on its row, which is where it is
    reconciled.
- **All schedules.** One row per schedule: the amount, how it repeats, when it
  is next due (and how far ahead it is registered), its mode, and where this
  month's occurrence stands. The figures give what the schedules add up to per
  month and per year. Click a row to edit it; its **⋯** menu posts now, skips,
  edits or deletes it.
- **Adding and editing.** **New schedule** opens a sheet beside the page: the
  name, the amount, the account, how often and from when, and whether it posts
  itself. **More details** holds the payee, category, memo, payment mode, the
  weekend handling, **Post days early** and a limit on the number of occurrences.
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

A budget is how much you plan to spend in each category, compared with what you
actually spent.

- **Budget tab.** Set an amount per category.
  - **Same** is one amount for every month.
  - **Monthly** is twelve amounts, one per month, for spending that changes with
    the seasons.
  - A budget applies **Every year** unless you set one for a particular year,
    which then takes over for that year.
- **Report tab.** Budget, actual and difference per category over the months
  you pick. **Roll up subcategories** adds subcategories into their parent.
  **Export CSV** downloads the table.

The dashboard's **Budget** widget shows this month at a glance.

## Goals

A goal is money you are putting aside for something, such as a holiday or a
rainy-day fund.

- **Setting one up.** Give it a target, and optionally a date and a linked
  account.
- **Filling it.** **Add** and **Withdraw** record money going in and out;
  **History** lists every change.

A goal is a piggy bank you fill by hand: it moves no real money, and the linked
account is only a reference.

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

## Vehicles

Vehicles feed the **Vehicle** report: what a car costs to run and what it uses.

1. **Add the vehicle** on the Vehicles page.
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

Review collects the imported and bank-synced transactions that need you:

- **Needs a category.** Transactions that arrived without a category. Set one
  and they leave the list.
- **Possible duplicates.** Pairs that look like the same movement entered twice,
  one from the bank and one by hand.
  - **Keep this** merges the pair into the side you chose.
  - **Not a duplicate** keeps both and stops asking.

Review has no place in the sidebar. You reach it from the **to review** button in
an account's register, and from the dashboard's list of what wants your
attention.

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
| **Security** | Two-factor sign-in, API tokens, notifications |
| **Bank sync & AI** | Bank connections ([Automatic bank sync](bank-sync.md)) and the optional AI category suggestions |
| **Import & export** | Imports ([Importing transactions](import.md)), exports, backups and a database check |
| **People** | Administrators only: the people who can sign in |
| **About** | The version, the licence and the source code |
