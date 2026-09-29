# Getting started

From a fresh install to recording money coming in and going out: about ten
minutes. This guide assumes CloudBank is running; if it is not, follow the
[Quick start](../README.md#quick-start) first.

> **Coming from HomeBank?** Skip steps 2 to 5: importing your `.xhb` file creates
> the wallet with its accounts, categories and payees already in place. See
> [Migrating from HomeBank](migrate-from-homebank.md).

## 1. Create the administrator

The first time you open CloudBank, it asks for an administrator account: a
username and a password of at least 8 characters. The email is optional.

This is the account that manages the server: it can add other people later. Once
it is created you are signed in.

## 2. Create your first wallet

A **wallet** is one set of books: its own accounts, categories, payees and
transactions, like one HomeBank file. Most people need one. A second wallet is
for books you keep apart, such as a small business or someone else's finances
you look after.

- **Wallet name:** anything, such as *Household*.
- **Owner name:** optional.
- **Base currency:** the currency totals and reports are shown in. **Choose it
  carefully: it cannot be changed later.** Accounts can still hold other
  currencies; they are converted with the rates under **Currencies**.

Your wallet opens on the **Dashboard**, which stays mostly empty until the next
steps give it something to show.

## 3. Take the tour, if you like

The dashboard offers a six-step tour of the essentials. Each page offers its own
tour the first time you open it, and the **?** in a page's header plays it again
whenever you want. If you would rather not be offered them, turn the offers off
under **Settings → General**.

## 4. Add your accounts

An account is where transactions live: a bank account, the cash in your wallet,
a credit card. Open **Accounts** and choose **Add account**.

| Field | What to put |
| --- | --- |
| **Account name** | What you call it: *Current account*, *Cash*, *Visa* |
| **Type** | Bank, Cash, Checking, Savings, Credit card, Liability, Asset or Investment |
| **Currency** | The wallet's base currency unless the account is held in another one |
| **Initial balance** | The balance on the day you start recording (see below) |

The rest (minimum balance, institution, account number, group, default payment
mode) is optional and can be filled in later.

**Start from today, not from the beginning.** Take the balance from your latest
statement as the initial balance, and record from the day after. Entering years
of history by hand is rarely worth it. If you want history, [import](import.md)
your bank's export instead.

## 5. Create your categories

Categories are how your spending is grouped, and every report is built from
them.

**Set up a few categories before your first entry.** The entry sheet can create
a missing one as you type, but a list made in one go is easier to keep tidy.

Categories have their own page in the sidebar:

1. Open **Categories**, in the **Wallet data** group.
2. Use **Add category** for each one.

Tips for the list:

- **Two levels.** A category can have subcategories, such as *Food* with
  *Groceries* and *Eating out*. Choose a **Parent category** when adding one.
- **Income categories.** Tick **Income category** for money coming in, such as
  *Salary*.
- **Start small.** Ten or so categories, grouped the way you think about your
  spending, not the way your bank does. You can add, rename and merge them
  later without losing anything.
- **Imports create the missing ones.** An imported file whose rows name
  categories you don't have creates them.

**Payees** (who you pay and who pays you) work the same way. They are optional:
a transaction needs no payee. Manage them on **Payees**, next to **Categories**
in **Wallet data**. A payee can carry a default category, so its transactions
arrive already sorted.

## 6. Record transactions

Open **Transactions**: it shows one account's register. Choose **Add
transaction**, or press **N**, and the entry sheet opens with the cursor in the
amount.

- **Amount.** Type the amount. It is an expense unless you type a `+` in front
  of it, or flip the **−** switch beside it.
- **Date.** Today, unless you change it.
- **Account.** The account whose register you are in.
- **Memo.** What it was, in your own words.
- **Category.** Pick one from the list.
- **More details.** Payee, a reference number, tags, and **Split across
  categories** for one payment that covers several things, such as a
  supermarket receipt with food and household items.
- **Saving.** **Enter** saves. **Shift+Enter** saves and opens a new entry,
  keeping the date, for when you are working through a pile of receipts.

The dashboard's **Add transaction** does the same from anywhere.

You don't have to type every transaction:

- **Import** a file from your bank: CSV, QIF, OFX or CAMT.053. See
  [Importing transactions](import.md).
- **Connect your bank** so new transactions arrive by themselves. See
  [Automatic bank sync](bank-sync.md).
- **Schedule** what repeats, like rent or a salary, on the **Schedules** page.
  CloudBank records each one as it comes due.

## 7. Keep it matching the bank

Every transaction has a **status**:

- **None:** just recorded.
- **Cleared:** you have seen it go through.
- **Reconciled:** checked against a statement.
- **Remind** and **Void** are for the less common cases.

An account shows up to three balances:

| Balance | Counts |
| --- | --- |
| **Reconciled** | Only reconciled transactions: what the bank has confirmed |
| **Today** | Everything up to today, reconciled or not |
| **Future** | Everything, including scheduled transactions still to come |

When a statement arrives, open the register, then **⋯ → Reconcile**. Tick each
transaction that appears on the statement until the difference is zero, then
finish. Those transactions become reconciled, and the **Reconciled** balance
matches the statement.

## What next

Every page is described in [Using CloudBank, page by page](pages.md). A few to
look at first:

- **Budget.** Plan what you mean to spend in each category, and see it against
  what you actually spent.
- **Rules.** Fill in the payee and category from what a transaction says, so
  imports and bank sync arrive sorted.
- **Reports.** Where the money went, what came in and went out, and what your
  accounts will hold.
- **Backups.** Before you rely on CloudBank, set up backups: see
  [Backups, upgrades and restoring](backup.md).
- **On your phone.** CloudBank installs as an app: see
  [Install as an app](../README.md#install-as-an-app-pwa).
- **Other people.** An administrator adds them under **Settings → People**. Each
  person signs in with their own account and keeps their own wallets.
- **Your preferences.** Language, theme, date format and which balances you see
  are under **Settings → General** and **Settings → Appearance**.
