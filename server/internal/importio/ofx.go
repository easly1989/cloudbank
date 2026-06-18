package importio

import (
	"fmt"
	"regexp"
	"strings"
)

// stmtTrnRe matches each statement-transaction aggregate. OFX 1.x (SGML) and
// 2.x (XML) both close <STMTTRN> with </STMTTRN>, so one pattern handles both.
var stmtTrnRe = regexp.MustCompile(`(?is)<STMTTRN>(.*?)</STMTTRN>`)

// leaf field extractor: grabs the value after <TAG> up to the next '<'. In XML
// that stops at the closing </TAG>; in SGML it stops at the next element. This
// makes a single expression work for both dialects.
func ofxField(block, tag string) string {
	re := regexp.MustCompile(`(?is)<` + tag + `>([^<\r\n]*)`)
	m := re.FindStringSubmatch(block)
	if m == nil {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// ParseOFX parses an OFX/QFX document (1.x SGML or 2.x XML) into rows. Each
// transaction's FITID is recorded for duplicate detection across re-imports.
func ParseOFX(content string) ([]Row, error) {
	if !strings.Contains(strings.ToUpper(content), "<OFX") {
		return nil, fmt.Errorf("not an OFX document")
	}
	blocks := stmtTrnRe.FindAllStringSubmatch(content, -1)
	rows := make([]Row, 0, len(blocks))
	for i, m := range blocks {
		block := m[1]
		row := Row{
			Line:  i + 1,
			Payee: ofxField(block, "NAME"),
			Memo:  ofxField(block, "MEMO"),
			Info:  ofxField(block, "CHECKNUM"),
			FITID: ofxField(block, "FITID"),
		}
		// PAYEE aggregate's <NAME> wins over a top-level NAME if present.
		if p := ofxField(block, "PAYEE"); p != "" && row.Payee == "" {
			row.Payee = p
		}

		date, err := parseOFXDate(ofxField(block, "DTPOSTED"))
		if err != nil {
			row.Err = err.Error()
			rows = append(rows, row)
			continue
		}
		row.Date = date

		amt, err := parseAmountFlexible(ofxField(block, "TRNAMT"), 6)
		if err != nil {
			row.Err = "invalid amount"
			rows = append(rows, row)
			continue
		}
		row.Amount = amt
		row.PaymentMode = ofxPaymode(ofxField(block, "TRNTYPE"))
		rows = append(rows, row)
	}
	return rows, nil
}

// parseOFXDate reads an OFX date (YYYYMMDD optionally followed by HHMMSS and a
// timezone) and returns the civil date YYYY-MM-DD.
func parseOFXDate(s string) (string, error) {
	s = strings.TrimSpace(s)
	if len(s) < 8 {
		return "", fmt.Errorf("invalid OFX date %q", s)
	}
	y, mo, d := s[0:4], s[4:6], s[6:8]
	for _, p := range []string{y, mo, d} {
		for _, c := range p {
			if c < '0' || c > '9' {
				return "", fmt.Errorf("invalid OFX date %q", s)
			}
		}
	}
	return y + "-" + mo + "-" + d, nil
}

// ofxPaymode maps a few OFX TRNTYPE values to HomeBank payment modes; unknown
// types fall back to none (0).
func ofxPaymode(trnType string) int {
	switch strings.ToUpper(strings.TrimSpace(trnType)) {
	case "CHECK":
		return 2 // check
	case "ATM", "CASH":
		return 3 // cash
	case "DIRECTDEBIT":
		return 11 // direct debit
	case "DEP", "DIRECTDEP":
		return 9 // deposit
	case "XFER":
		return 4 // transfer
	default:
		return 0
	}
}
