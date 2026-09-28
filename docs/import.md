# Importing transactions

CloudBank reads the files banks and other finance apps export: CSV, QIF, OFX/QFX
and CAMT.053, plus a few bank-specific formats. Every import goes into **one
account** that you choose, and nothing is saved until you have seen a preview of
every row.

Imports live in **Settings → Import & export**, on the **Bank / CSV / QIF / OFX**
tab.

> **Coming from HomeBank?** Import your `.xhb` file on the **HomeBank file** tab
> instead. It recreates the whole wallet in one go: accounts, categories,
> schedules, rules and budgets. See
> [Migrating from HomeBank](migrate-from-homebank.md).

## Which format to choose

| You have | Choose |
| --- | --- |
| A CSV or spreadsheet export from your bank | **Generic CSV** |
| A CSV exported by HomeBank (or written to its layout) | **HomeBank CSV** |
| A `.qif` file (Quicken, older apps, many banks) | **QIF** |
| A `.ofx` or `.qfx` file | **OFX/QFX** |
| An ISO 20022 statement, `camt.053` (`.xml`), from a European bank | **CAMT.053** |
| An Intesa Sanpaolo "Movimenti Conto" Excel file | **Bank**, then Intesa Sanpaolo |

**A bank's CSV is almost always *Generic CSV*.** **HomeBank CSV** is a fixed
layout that bank exports do not follow. Picked for a bank file, it marks every
row with an error.

If your bank offers OFX, QIF or CAMT.053 as well as CSV, prefer those: there are
no columns to map, and OFX also recognises rows you have already imported.

## The steps

1. **Source.** Pick the format and the account the transactions go into, then
   choose the file. The Generic CSV and QIF formats ask a few more questions
   about the file; they are described below.
2. **Map columns** (Generic CSV only). Say which column holds the date, the
   amount, and so on.
3. **Review.** Every row the file contains, with what CloudBank will do with it.
   Untick a row to leave it out, and set a category or tags on a row before
   importing. Nothing is saved yet.
4. **Done.** A summary of what was created. **Review & categorise** opens the
   register showing only the transactions still without a category.

## Generic CSV

The first step has four settings. Look at your file in a text editor (not a
spreadsheet, which hides the separators) to answer them.

| Setting | What it means | Typical value |
| --- | --- | --- |
| **Delimiter** | The character between columns | `,` in the US and UK; `;` in most of Europe |
| **Decimal** | The decimal separator in amounts | `1234.56` or `1234,56` |
| **First row is a header** | The first line names the columns instead of holding a transaction | On for most bank exports |
| **Date format** | The order of day, month and year | **Auto-detect** works unless the file uses month-first dates |

**Auto-detect** tries `YYYY-MM-DD` first, then day-month-year, then
month-day-year. So `03/04/2026` is read as 3 April. A US file with dates like
that needs **MM-DD-YYYY**. The separator between day, month and year can be `/`,
`-` or `.`, and two-digit years are accepted.

### Mapping the columns

Each transaction field is a dropdown listing your file's columns: their names
when the file has a header, **Column 1**, **Column 2**, … when it does not.

| Field | Required | Notes |
| --- | --- | --- |
| **Date** | Yes | |
| **Amount** | Yes, unless you map Debit/Credit | One signed column: negative is money out |
| **Debit (out)** / **Credit (in)** | Instead of Amount | For files with separate money-out and money-in columns. The amount is credit minus debit; an empty cell counts as zero |
| **Payee** | | Created in CloudBank if it does not exist yet |
| **Memo** | | Most banks put their description here |
| **Category** | | `Parent:Sub` for a subcategory. Missing categories are created |
| **Tags** | | Separated by spaces, so each tag is one word |
| **Info** | | A reference or cheque number |
| **Payment mode** | | A number from 0 to 11, see [HomeBank CSV](#homebank-csv) |

Amounts can carry currency symbols, spaces and thousands separators:
`€ 1.850,00` reads as 1850.00 when the decimal is `,`. A `-` anywhere in the
cell, or parentheses around it, makes it negative.

**Invert sign** flips every amount, for the banks that write expenses as positive
numbers and income as negative ones.

### An example

A typical European bank export, with separate columns for money out and in:

```text
Data operazione;Descrizione;Uscite;Entrate
01/09/2026;PAGAMENTO POS BAR CENTRALE;3,50;
02/09/2026;STIPENDIO SETTEMBRE;;1.850,00
```

- **Source:** Generic CSV, delimiter `;`, decimal `1234,56`, first row is a
  header, date format **DD-MM-YYYY** (or Auto-detect).
- **Map columns:** Date → *Data operazione*, Memo → *Descrizione*,
  Debit (out) → *Uscite*, Credit (in) → *Entrate*.
- **Review:** two rows, −3.50 on 1 September and +1,850.00 on 2 September.

## HomeBank CSV

HomeBank's own transaction CSV has no header and eight columns, separated by `;`:

```text
date;payment mode;info;payee;memo;amount;category;tags
2026-09-03;6;;Bar Centrale;Coffee;-3.50;Food:Coffee;work breakfast
```

- **Dates** are read as described under [Generic CSV](#generic-csv), with
  Auto-detect.
- **Amounts** use `.` as the decimal separator.
- **Categories** are `Parent:Sub`; **tags** are separated by spaces.
- **Payment mode** is a number:

| Code | Payment mode | Code | Payment mode |
| --- | --- | --- | --- |
| 0 | None | 6 | Debit card |
| 1 | Credit card | 7 | Standing order |
| 2 | Check | 8 | Electronic payment |
| 3 | Cash | 9 | Deposit |
| 4 | Bank transfer | 10 | FI fee |
| 5 | Internal transfer | 11 | Direct debit |

CloudBank exports an account in this layout too: see
[Getting your data out](#getting-your-data-out).

## QIF

- **Date format:** QIF files do not say which date order they use, so the first
  step asks, as for a CSV.
- **What is read:** only the transactions. The target account is the one you
  picked, so account and category lists in the file are skipped.
- **Split transactions** come in as one transaction for the total.
  - With a single split, its category becomes the transaction's category.
  - With several, the category is left empty and the memo notes the split.
- **Transfers** (a category like `[Savings]`) are imported as ordinary
  transactions, with the other account named in the memo.

## OFX/QFX

- **Versions:** both OFX 1.x (SGML) and 2.x (XML).
- **Payees and payment modes:** the payee comes from the transaction's name.
  The payment mode is derived from the transaction type.
- **Re-importing:** every OFX transaction carries an id from the bank. When you
  import an overlapping statement again, the rows you already have are shown as
  **Already imported** and left out.

## CAMT.053

- **What it is:** the ISO 20022 end-of-day statement, which most European banks
  offer as an `.xml` download. It is the file to use when your bank has no
  [automatic sync](bank-sync.md), or when you would rather not connect one.
- **Versions:** every `camt.053` version is read.
- **Booked and pending entries:**
  - **booked** entries are imported as cleared;
  - **pending** ones are imported with no status, because they can still change.
- **Payee:** whoever is on the other side of each movement.
- **Other CAMT files:** `camt.052` (intraday) and `camt.054` (notifications) are
  not supported. They repeat movements a `camt.053` already contains.

## Bank-specific formats

The **Bank** format lists files that need a reader of their own, such as a
spreadsheet export whose layout a CSV mapping cannot describe. Pick your bank,
then choose the file.

To add one for your bank, see [Writing a bank import plugin](import-plugins.md).

## The review

Each row shows its date, payee, category, tags and amount, and a badge when
something needs your attention:

| Badge | Meaning | Imported? |
| --- | --- | --- |
| **Duplicate** (yellow) | The account already has a transaction with the same date and amount | No: tick it if it is a genuine second transaction, like two identical coffees on one day |
| **Already imported** (grey) | An OFX row whose bank id you imported before | No |
| **Rule** (blue) | An [assignment rule](#assignment-rules) filled in the payee, category, payment mode or info | Yes |
| **Merge** / **Merge into…** | This row settles a pending transaction imported earlier. **Merge into…** lists the candidates when there are several | Yes: it updates that transaction instead of adding a new one |
| Red text | The row could not be read; the badge says why | No: fix the file, or the settings, and preview again |

The count above the table says how many rows will be imported. The **Import**
button saves them all in one go: either every row is saved, or none is.

### Assignment rules

**Apply import rules**, above the table, runs your rules on every row, and the
preview updates at once. Rules are managed on the **Rules** page. Only rules
with **On import** ticked run here. A rule matches text in the memo or the
payee, and fills in the payee, category, payment mode or info.

Rules turn a bank's `PAGAMENTO POS BAR CENTRALE` into payee *Bar Centrale*,
category *Food:Coffee*, so the next import needs no typing.

## After importing

- **Categorise what is left.** **Review & categorise** opens the register showing
  only uncategorised transactions. Select several rows to set a category, payee,
  tags or status on all of them at once.
- **Undo an import.** There is no undo button. Select the imported rows in the
  register and delete them.
- **Check the balance.** Compare the account's balance with your bank. The
  **Reconcile** action in the register helps you tick off a statement line by
  line.

## When something goes wrong

| What you see | Why, and what to do |
| --- | --- |
| Every row is red with "unrecognised date" | Often **HomeBank CSV** was chosen for a bank file: choose **Generic CSV**. Otherwise set the **Date format** and check that **Date** is mapped to the right column |
| The mapping step offers a single column holding the whole line | The **Delimiter** is wrong. Open the file in a text editor and use the character between the columns, often `;` |
| Amounts are 100 times too large, or small and wrong | The **Decimal** setting does not match the file |
| Expenses show as income | Turn on **Invert sign** |
| "invalid amount" | The amount column is mapped to the wrong column, or holds text. If money in and out are in separate columns, map **Debit (out)** and **Credit (in)** instead of Amount |
| Accented letters show as `�` | The file is not UTF-8. Re-save it as UTF-8, for example with Excel's *CSV UTF-8* option or a text editor, and import again |
| The column names are wrong, or the first rows are red | The bank put summary lines above the table. Delete everything above the header line and import again |
| The upload fails with a 413 error | A reverse proxy in front of CloudBank is limiting upload size. See `client_max_body_size` in [the reverse-proxy guide](reverse-proxy.md) |
| The page stops with "This page stopped working" | A bug in CloudBank, not in your file. Please [open an issue](https://github.com/easly1989/cloudbank/issues/new) with the format and the message shown. Don't attach a real statement: describe it, or send a copy with the amounts and names changed |

## Getting your data out

In **Settings → Import & export**, the **CSV export** tab exports an account as
**HomeBank CSV** or **QIF**. The whole wallet can be exported as a HomeBank
`.xhb` file or a JSON backup under **Backup & integrity**.
