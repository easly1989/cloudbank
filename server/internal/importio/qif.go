package importio

import (
	"strings"
)

// ParseQIF parses a QIF file's transaction records into rows. The target account
// is chosen in the wizard, so account (!Account) and category (!Type:Cat) list
// sections are skipped; only transaction records are returned. Splits (S/E/$) are
// read and flattened — the row keeps the record total (T); a single split sets
// the category, multiple splits leave it empty and note the split in the memo.
// Transfers (category "[Account]") keep the total and note the target in the memo.
func ParseQIF(content, dateFormat string) ([]Row, error) {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	rows := make([]Row, 0)

	skipSection := false // inside an !Account or !Type:Cat list section
	var cur qifRecord
	started := false
	lineNo := 0

	flush := func(endLine int) {
		if !started {
			return
		}
		if !skipSection && !cur.empty() {
			rows = append(rows, cur.toRow(endLine, dateFormat))
		}
		cur = qifRecord{}
		started = false
	}

	for i, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		if line == "" {
			continue
		}
		lineNo = i + 1

		if strings.HasPrefix(line, "!") {
			flush(lineNo)
			header := strings.ToLower(strings.TrimPrefix(line, "!"))
			// Account and category list sections carry no transactions.
			skipSection = strings.HasPrefix(header, "account") || strings.HasPrefix(header, "type:cat")
			continue
		}

		code := line[0]
		val := strings.TrimSpace(line[1:])
		started = true
		switch code {
		case 'D':
			cur.date = val
		case 'T', 'U':
			cur.amount = val
		case 'P':
			cur.payee = val
		case 'M':
			cur.memo = val
		case 'N':
			cur.number = val
		case 'C':
			cur.cleared = val
		case 'L':
			cur.category = val
		case 'S':
			cur.splitCats = append(cur.splitCats, val)
		case 'E':
			cur.splitMemos = append(cur.splitMemos, val)
		case '$':
			cur.splitAmts = append(cur.splitAmts, val)
		case '^':
			flush(lineNo)
		}
	}
	flush(lineNo + 1)
	return rows, nil
}

type qifRecord struct {
	date       string
	amount     string
	payee      string
	memo       string
	number     string
	cleared    string
	category   string
	splitCats  []string
	splitMemos []string
	splitAmts  []string
}

func (r qifRecord) empty() bool {
	return r.date == "" && r.amount == "" && r.payee == "" && r.memo == "" && r.category == ""
}

func (r qifRecord) toRow(line int, dateFormat string) Row {
	row := Row{Line: line, Info: r.number, Payee: r.payee, Memo: r.memo}

	date, err := parseDate(r.date, dateFormat)
	if err != nil {
		row.Err = err.Error()
		return row
	}
	row.Date = date

	amt, err := parseAmountFlexible(r.amount, 6)
	if err != nil {
		row.Err = "invalid amount"
		return row
	}
	row.Amount = amt

	// Category: a transfer "[Account]" is noted in the memo, not created as a
	// category. Otherwise use the L category or, for a single split, that split.
	cat := strings.TrimSpace(r.category)
	if strings.HasPrefix(cat, "[") && strings.HasSuffix(cat, "]") {
		target := strings.TrimSuffix(strings.TrimPrefix(cat, "["), "]")
		row.Memo = appendNote(row.Memo, "Transfer: "+target)
		cat = ""
	}
	switch {
	case cat != "":
		row.Category = qifCategory(cat)
	case len(r.splitCats) == 1:
		row.Category = qifCategory(r.splitCats[0])
	case len(r.splitCats) > 1:
		row.Memo = appendNote(row.Memo, "split")
	}

	if r.cleared == "X" || r.cleared == "R" {
		// reconciled — status is left at 0 (none) on import; HomeBank treats QIF
		// cleared flags as advisory. Recorded here for completeness.
		_ = r.cleared
	}
	return row
}

// qifCategory converts a QIF category ("Parent:Sub" already, sometimes with a
// "/class" suffix) to our full category name, dropping any class.
func qifCategory(c string) string {
	if i := strings.IndexByte(c, '/'); i >= 0 {
		c = c[:i]
	}
	return strings.TrimSpace(c)
}

func appendNote(memo, note string) string {
	if memo == "" {
		return note
	}
	return memo + " (" + note + ")"
}

// QIFExportRow is one transaction to write to a QIF file.
type QIFExportRow struct {
	Date       string
	Amount     int64
	FracDigits int
	Payee      string
	Memo       string
	Category   string
	Info       string
}

// qifTypeForAccount maps a CloudBank account type to a QIF !Type header.
func qifTypeForAccount(accountType string) string {
	switch accountType {
	case "cash":
		return "Cash"
	case "creditcard":
		return "CCard"
	case "asset":
		return "Oth A"
	case "liability":
		return "Oth L"
	default:
		return "Bank"
	}
}

// FormatQIF renders rows as a QIF file for the given account type. Dates are
// written ISO (YYYY-MM-DD); HomeBank's QIF import accepts this with its date
// format set to y-m-d. QIF has no tag field, so tags are not exported.
func FormatQIF(accountType string, rows []QIFExportRow) string {
	var b strings.Builder
	b.WriteString("!Type:" + qifTypeForAccount(accountType) + "\n")
	for _, r := range rows {
		b.WriteString("D" + r.Date + "\n")
		b.WriteString("T" + formatPlainAmount(r.Amount, r.FracDigits) + "\n")
		if r.Info != "" {
			b.WriteString("N" + r.Info + "\n")
		}
		if r.Payee != "" {
			b.WriteString("P" + r.Payee + "\n")
		}
		if r.Memo != "" {
			b.WriteString("M" + r.Memo + "\n")
		}
		if r.Category != "" {
			b.WriteString("L" + r.Category + "\n")
		}
		b.WriteString("^\n")
	}
	return b.String()
}
