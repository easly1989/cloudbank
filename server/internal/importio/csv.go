// Package importio implements transaction import and export across the formats
// CloudBank understands — CSV (the HomeBank dialect plus generic mapped CSV),
// QIF and OFX/QFX. Parsing and formatting are pure (no database); the Service
// layer resolves payees, categories and tags, flags duplicates and persists the
// result through the shared preview/commit pipeline.
package importio

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/easly1989/cloudbank/server/internal/money"
)

// Dialect selects the column convention of a CSV file.
type Dialect string

const (
	// DialectHomeBank is HomeBank's own transaction CSV: semicolon-separated,
	// no header, fixed column order date;paymode;info;payee;memo;amount;category;tags.
	DialectHomeBank Dialect = "homebank"
	// DialectGeneric is an arbitrary CSV mapped column-by-column by the user.
	DialectGeneric Dialect = "generic"
)

// Field names used by the generic column mapping and the HomeBank fixed layout.
const (
	FieldDate     = "date"
	FieldPaymode  = "paymode"
	FieldInfo     = "info"
	FieldPayee    = "payee"
	FieldMemo     = "memo"
	FieldAmount   = "amount"
	FieldCategory = "category"
	FieldTags     = "tags"
)

// homebankLayout is the fixed column order of the HomeBank CSV dialect.
var homebankLayout = map[string]int{
	FieldDate: 0, FieldPaymode: 1, FieldInfo: 2, FieldPayee: 3,
	FieldMemo: 4, FieldAmount: 5, FieldCategory: 6, FieldTags: 7,
}

// CategorySep joins a parent and sub-category in a full category name, matching
// HomeBank's CSV convention ("Parent:Sub").
const CategorySep = ":"

// ParseOptions configures how a CSV body is interpreted.
type ParseOptions struct {
	Dialect     Dialect
	Delimiter   string         // single character; defaults per dialect
	HasHeader   bool           // skip the first row (generic only)
	DateFormat  string         // "iso"/"ymd", "dmy", "mdy"; "" = auto
	DecimalChar string         // "." or ","; "" defaults to "."
	Mapping     map[string]int // generic: field name → column index
}

// Row is one parsed CSV transaction line, before payee/category resolution.
type Row struct {
	Line        int      // 1-based source line
	Date        string   // YYYY-MM-DD
	Amount      int64    // minor units (signed)
	PaymentMode int      // 0..11
	Info        string   // the "info"/number field
	Payee       string   // payee name
	Memo        string   // memo
	Category    string   // full category name ("Parent:Sub") or ""
	Tags        []string // tag names
	FITID       string   // OFX financial-institution transaction id (for dedupe)
	Err         string   // non-empty when this line could not be parsed
}

// detectColumns returns the header (or generated column names) for the body, to
// drive the generic mapping UI.
func detectColumns(content, delimiter string, hasHeader bool) ([]string, error) {
	records, err := readAll(content, delimiter)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return []string{}, nil
	}
	if hasHeader {
		return records[0], nil
	}
	cols := make([]string, len(records[0]))
	for i := range cols {
		cols[i] = fmt.Sprintf("Column %d", i+1)
	}
	return cols, nil
}

// readAll parses the CSV body into records, tolerating ragged rows and quotes.
func readAll(content, delimiter string) ([][]string, error) {
	r := csv.NewReader(strings.NewReader(content))
	r.Comma = delimiterRune(delimiter)
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	r.TrimLeadingSpace = true
	return r.ReadAll()
}

func delimiterRune(delimiter string) rune {
	if delimiter == "" {
		return ';'
	}
	for _, r := range delimiter {
		return r
	}
	return ';'
}

// Parse turns a CSV body into rows using the options. Lines that fail to parse
// are returned with Err set rather than dropped, so the caller can surface them.
func Parse(content string, opts ParseOptions) ([]Row, error) {
	colmap := opts.Mapping
	delimiter := opts.Delimiter
	hasHeader := opts.HasHeader
	if opts.Dialect == DialectHomeBank {
		colmap = homebankLayout
		if delimiter == "" {
			delimiter = ";"
		}
		hasHeader = false
	}
	if delimiter == "" {
		delimiter = ","
	}
	if colmap == nil {
		return nil, fmt.Errorf("no column mapping")
	}
	decimalChar := opts.DecimalChar
	if decimalChar == "" {
		decimalChar = "."
	}

	records, err := readAll(content, delimiter)
	if err != nil {
		return nil, err
	}
	start := 0
	if hasHeader && len(records) > 0 {
		start = 1
	}

	rows := make([]Row, 0, len(records))
	for i := start; i < len(records); i++ {
		rec := records[i]
		if isBlank(rec) {
			continue
		}
		row := Row{Line: i + 1}
		get := func(field string) string {
			idx, ok := colmap[field]
			if !ok || idx < 0 || idx >= len(rec) {
				return ""
			}
			return strings.TrimSpace(rec[idx])
		}

		date, derr := parseDate(get(FieldDate), opts.DateFormat)
		if derr != nil {
			row.Err = derr.Error()
			rows = append(rows, row)
			continue
		}
		row.Date = date

		amtStr := get(FieldAmount)
		amt, aerr := money.Parse(amtStr, 6, decimalChar) // parse at high precision; rescale below
		if aerr != nil {
			row.Err = fmt.Sprintf("invalid amount %q", amtStr)
			rows = append(rows, row)
			continue
		}
		row.Amount = amt // caller rescales to the account's fraction digits

		row.PaymentMode = parsePaymode(get(FieldPaymode))
		row.Info = get(FieldInfo)
		row.Payee = get(FieldPayee)
		row.Memo = get(FieldMemo)
		row.Category = get(FieldCategory)
		row.Tags = splitTags(get(FieldTags))
		rows = append(rows, row)
	}
	return rows, nil
}

// rescaleAmount is used by Parse callers: amounts are parsed at 6 fraction
// digits, then rescaled to the account currency's fraction digits.
func rescaleAmount(amount6 int64, frac int) int64 {
	if frac >= 6 {
		return amount6 * pow10(frac-6)
	}
	div := pow10(6 - frac)
	q := amount6 / div
	r := amount6 % div
	half := div / 2
	if r >= half {
		q++
	} else if -r >= half {
		q--
	}
	return q
}

func pow10(n int) int64 {
	out := int64(1)
	for i := 0; i < n; i++ {
		out *= 10
	}
	return out
}

// parseAmountFlexible parses an amount whose decimal separator may be '.' or ','
// (the later-occurring of the two is the decimal point; the other is treated as
// a thousands separator and ignored). Used by the QIF/OFX parsers.
func parseAmountFlexible(s string, frac int) (int64, error) {
	dc := "."
	if i := strings.LastIndexAny(s, ".,"); i >= 0 {
		dc = string(s[i])
	}
	return money.Parse(s, frac, dc)
}

// formatPlainAmount formats minor units with a dot decimal, no thousands
// separator and no symbol — the canonical CSV/QIF amount form.
func formatPlainAmount(amount int64, frac int) string {
	return money.Format(amount, frac, ".", "", "", false)
}

func parsePaymode(s string) int {
	if s == "" {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	if n < 0 {
		return 0
	}
	if n > 11 {
		return 11
	}
	return n
}

func splitTags(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Fields(s)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func isBlank(rec []string) bool {
	for _, c := range rec {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

// parseDate normalises a CSV date to YYYY-MM-DD. The format hint selects the
// field order; "" tries ISO, then day-month-year, then month-day-year.
func parseDate(s, format string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("missing date")
	}
	// Normalise separators (CSV uses / . -, QIF uses / ' and stray spaces).
	norm := strings.NewReplacer("/", "-", ".", "-", "'", "-", " ", "").Replace(s)
	var layouts []string
	switch format {
	case "iso", "ymd":
		layouts = []string{"2006-1-2"}
	case "dmy":
		layouts = []string{"2-1-2006", "2-1-06"}
	case "mdy":
		layouts = []string{"1-2-2006", "1-2-06"}
	default:
		layouts = []string{"2006-1-2", "2-1-2006", "1-2-2006", "2-1-06", "1-2-06"}
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, norm); err == nil {
			return t.Format("2006-01-02"), nil
		}
	}
	return "", fmt.Errorf("unrecognised date %q", s)
}

// ExportRow is one transaction to write to a HomeBank CSV.
type ExportRow struct {
	Date        string
	PaymentMode int
	Info        string
	Payee       string
	Memo        string
	Amount      int64
	FracDigits  int
	Category    string // full name ("Parent:Sub") or ""
	Tags        []string
}

// FormatHomeBankCSV writes rows as a HomeBank-dialect CSV string (semicolon
// separated, ISO dates, dot decimal, no thousands separators). HomeBank's CSV
// importer accepts this when its date format is set to y-m-d.
func FormatHomeBankCSV(rows []ExportRow) (string, error) {
	var b strings.Builder
	w := csv.NewWriter(&b)
	w.Comma = ';'
	for _, r := range rows {
		amount := formatPlainAmount(r.Amount, r.FracDigits)
		rec := []string{
			r.Date,
			strconv.Itoa(r.PaymentMode),
			r.Info,
			r.Payee,
			r.Memo,
			amount,
			r.Category,
			strings.Join(r.Tags, " "),
		}
		if err := w.Write(rec); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return b.String(), nil
}
