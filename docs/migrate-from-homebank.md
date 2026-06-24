# Migrating from HomeBank

CloudBank imports a HomeBank file (`.xhb`) directly — one upload recreates the
whole wallet: currencies, accounts, payees, categories, tags, transactions (with
splits and re-paired transfers), scheduled transactions and templates, assignment
rules and budgets. Amounts are converted exactly, so balances match HomeBank to
the cent.

## 1. Find your `.xhb` file

In HomeBank, your file is what you open from **File → Open**. By default it lives
in your home directory (for example `~/MyAccounts.xhb`). It is a single,
self-contained XML file — no separate attachments are needed.

> Tip: work on a **copy**. The import never modifies your `.xhb`, but keeping the
> original untouched is good practice.

If you keep your data inside HomeBank's own folder and aren't sure of the path,
use **File → Save as…** in HomeBank to write a fresh copy somewhere obvious.

## 2. Import it into CloudBank

1. Log in to CloudBank.
2. Go to **Import** in the sidebar (the **HomeBank file** tab).
3. Choose your `.xhb` file and click **Import**.
4. CloudBank creates a **new wallet** from the file and shows a summary of how
   many of each entity were imported, plus any warnings. The import is
   all-or-nothing: if anything fails, nothing is created.

The new wallet becomes the active one. Open **Accounts** and the **register** to
confirm your balances; they should equal HomeBank's exactly.

## 3. Verify

A quick check after importing:

- **Accounts** screen: each account's balance matches HomeBank.
- **Register** (Transactions): split transactions show their parts, and transfers
  are shown as linked pairs.
- **Budget** and **Reports**: your categories and budgets carried over.
- **Schedules**: your scheduled transactions are listed (CloudBank will resume
  posting them automatically).

If a balance is off, it almost always means the `.xhb` you imported wasn't the
latest save — re-export from HomeBank and import again into a fresh wallet.

## What is and isn't carried over

- **Carried over:** currencies and their rates, accounts and their flags, payees
  (with defaults), the two-level category tree, tags, every transaction with its
  payment mode, status, info, memo, splits and tags, internal transfers,
  templates, schedules, assignment rules and budgets.
- **Not applicable:** HomeBank UI preferences and window layout (CloudBank has its
  own preferences). Investment positions/quotes are not modelled (HomeBank itself
  has no live quotes; investment accounts behave as normal ledger accounts).

## Other formats

If you're coming from another tool, CloudBank also imports **CSV** (the HomeBank
CSV dialect and generic mapped CSV), **QIF**, and **OFX/QFX** from the same
**Import** screen, with duplicate detection and optional rule application.

## Exporting back to HomeBank (`.xhb`)

CloudBank can export a wallet **back to a HomeBank `.xhb` file**, so you're never
locked in. Go to **Settings → Wallet → Backup & restore** and click
**Export .xhb**; the downloaded file opens directly in the HomeBank desktop app.

The export reverses the import exactly — accounts, payees, categories, tags,
transactions (with splits and re-paired transfers), schedules, templates,
assignment rules and budgets — so a round-trip (export from CloudBank → open in
HomeBank, or export → re-import into a fresh CloudBank wallet) preserves entity
counts and per-account balances to the cent.

## Re-importing later / round-tripping

Re-running the `.xhb` import always creates a **new** wallet, so it never clobbers
existing data. To move data back out, use the **`.xhb` export** above, **CSV/QIF
export** per account, or take a full **wallet backup** (portable JSON) from the
wallet settings.
