# Writing an import plugin

CloudBank can import a bank's statement export directly. Beyond the built-in
generic CSV, QIF and OFX/QFX importers, **bank-specific plugins** handle formats
those can't — a bank's Excel export, a fixed CSV layout with quirks, and so on.

A plugin is deliberately small: it is **just a parser**. You turn the uploaded
file's bytes into a slice of normalized `Row`s; the shared pipeline does
everything else — rescaling amounts to the account's currency, flagging
duplicates, applying import rules, reconciling settled rows against pending ones,
and committing. So you never touch the database, and the format needn't be
Excel-based.

Everything here lives in [`server/internal/importio`](../server/internal/importio).

## The contract

A plugin is one entry in the registry, described by `ImportPlugin`
([`plugins.go`](../server/internal/importio/plugins.go)):

```go
type ImportPlugin struct {
	ID      string   // stable id, e.g. "intesa-sanpaolo-xlsx"
	Label   string   // shown in the picker, e.g. "Intesa Sanpaolo — Excel (Movimenti Conto)"
	Country string   // ISO country, e.g. "IT"
	Bank    string   // display name, e.g. "Intesa Sanpaolo"
	Accept  []string // file extensions for the file picker, e.g. [".xlsx"]

	// Parse turns the uploaded file bytes into normalized rows.
	Parse func([]byte) ([]Row, error)
}
```

`Parse` receives the raw file bytes and returns the transactions it found.

## The `Row` you produce

Each `Row` is one transaction, **before** payee/category resolution and currency
rescaling (`csv.go`):

```go
type Row struct {
	Line        int      // 1-based source line/row, for error messages
	Date        string   // civil date, "YYYY-MM-DD"
	Amount      int64     // signed, at SIX fraction digits (see below)
	PaymentMode int      // HomeBank payment mode 0..11 (0 = none)
	Info        string   // the "info"/reference/cheque-number field
	Payee       string   // payee name (resolved/created by the pipeline)
	Memo        string   // free-text memo
	Category    string   // full category name "Parent:Sub", or ""
	Tags        []string // tag names
	FITID       string   // a stable per-transaction id, for de-duplication
	Status      int      // 0 none, 1 cleared, 2 reconciled
	MatchDate   string   // a settled row's real purchase date, for reconciliation ("" = skip)
	Err         string   // non-empty marks a row that could not be parsed
}
```

A few rules matter:

- **Amounts are at six fraction digits.** Return the value scaled by `1e6`
  (e.g. `12.34` → `12_340000`, an outflow → negative). The pipeline rescales to
  the account currency's own fraction digits, so you don't need to know it.
  Sign convention is CloudBank's: **expenses negative, income positive.** Use the
  helper `parseAmountFlexible(s, 6)` to parse a decimal string whose separator may
  be `.` or `,`.
- **Dates are civil dates** — `"YYYY-MM-DD"` strings, no timezone math.
- **Never drop a row you couldn't parse.** Set `Err` instead and append it; the
  wizard shows it flagged and excluded, so nothing is silently lost.
- **`FITID`** is how duplicates are caught on re-import. If the bank gives a
  transaction id, use it; otherwise synthesize a stable one from fields that
  identify the movement (see `intesaRef` for an example). When empty, the
  pipeline falls back to date+amount matching.
- **`MatchDate`** lets a settled (posted) row reconcile against a still-pending
  transaction you imported earlier, instead of adding a duplicate. Set it to the
  movement's real purchase date; leave `""` if the concept doesn't apply.
- **`Status`** is usually `1` (cleared) for a bank statement row.

## Registering it

Add your plugin to the `plugins` slice in
[`plugins.go`](../server/internal/importio/plugins.go) and point `Parse` at your
function:

```go
var plugins = []ImportPlugin{
	{
		ID:      "intesa-sanpaolo-xlsx",
		Label:   "Intesa Sanpaolo — Excel (Movimenti Conto)",
		Country: "IT",
		Bank:    "Intesa Sanpaolo",
		Accept:  []string{".xlsx"},
		Parse:   ParseIntesaXLSX,
	},
	// your plugin here
}
```

That's all the wiring: the plugin then appears in the import wizard's **Bank**
picker automatically, and the endpoint runs your `Parse` over the uploaded bytes
before the shared preview pipeline.

## A minimal worked example

A simple fixed-layout CSV plugin (real plugins live in their own file, e.g.
[`intesa.go`](../server/internal/importio/intesa.go)):

```go
// ParseAcmeCSV parses ACME Bank's "Date;Description;Amount" export.
func ParseAcmeCSV(content []byte) ([]Row, error) {
	records, err := readAll(string(content), ";")
	if err != nil {
		return nil, err
	}
	rows := make([]Row, 0, len(records))
	for i, rec := range records[1:] { // skip the header
		if len(rec) < 3 {
			continue
		}
		row := Row{Line: i + 2, Status: 1}
		date, ok := parseACMEDate(rec[0]) // your date parser → "YYYY-MM-DD", ok
		if !ok {
			row.Err = "bad date"
			rows = append(rows, row)
			continue
		}
		amount, err := parseAmountFlexible(strings.TrimSpace(rec[2]), 6)
		if err != nil {
			row.Err = "bad amount"
			rows = append(rows, row)
			continue
		}
		row.Date, row.Memo, row.Amount = date, strings.TrimSpace(rec[1]), amount
		rows = append(rows, row)
	}
	return rows, nil
}
```

Study [`intesa.go`](../server/internal/importio/intesa.go) for a complete example
(Excel parsing, a synthesized `FITID`, weekend/date handling and `MatchDate`).

## Testing

Add a `_test.go` beside your plugin with a small **golden fixture** and assert the
parsed `Row`s (amounts at 6 fraction digits). Keep fixtures tiny and synthetic:

> **Do not commit a real personal bank statement.** Redact it down to a couple of
> fabricated rows that exercise the format — the file lives in the public repo.

Run `go test ./internal/importio/...`.

## Clean-room and licensing

Contributions are licensed under the project's [AGPL-3.0](../LICENSE). Write your
parser from the bank's file format alone — **do not** copy code from HomeBank or
any other GPL/incompatible source. CloudBank is a clean-room reimplementation and
must stay one.
