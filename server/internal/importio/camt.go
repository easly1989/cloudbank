package importio

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

// CAMT.053 ("BankToCustomerStatement") is the ISO 20022 end-of-day statement
// most European banks offer as a download. It is the format to reach for when a
// bank has no PSD2 connection, or when the user would rather not link one.
//
// Only camt.053 is handled here. camt.052 (intraday) and camt.054 (debit/credit
// notifications) share much of this shape but answer different questions, and
// conflating them would import the same movement twice.
//
// The structs below deliberately name only local element names: encoding/xml
// then matches them in any namespace, so every camt.053 minor version
// (.001.02 through .001.08+) decodes without a version switch. Where versions
// genuinely differ in shape — the status element, party names — both forms are
// declared and resolved by the accessor.

type camtDocument struct {
	Statements []camtStatement `xml:"BkToCstmrStmt>Stmt"`
}

type camtStatement struct {
	Entries []camtEntry `xml:"Ntry"`
}

type camtEntry struct {
	Amount       camtAmount      `xml:"Amt"`
	CdtDbtInd    string          `xml:"CdtDbtInd"`
	Status       camtStatus      `xml:"Sts"`
	BookingDate  camtDate        `xml:"BookgDt"`
	ValueDate    camtDate        `xml:"ValDt"`
	AcctSvcrRef  string          `xml:"AcctSvcrRef"`
	AddtlNtryInf string          `xml:"AddtlNtryInf"`
	Details      []camtTxDetails `xml:"NtryDtls>TxDtls"`
}

type camtAmount struct {
	Currency string `xml:"Ccy,attr"`
	Value    string `xml:",chardata"`
}

// camtStatus is <Sts>BOOK</Sts> in older versions and <Sts><Cd>BOOK</Cd></Sts>
// from .001.08 onwards.
type camtStatus struct {
	Code string `xml:"Cd"`
	Text string `xml:",chardata"`
}

func (s camtStatus) value() string {
	if c := strings.TrimSpace(s.Code); c != "" {
		return c
	}
	return strings.TrimSpace(s.Text)
}

// camtDate is <Dt> (a civil date) or <DtTm> (a timestamp); only the calendar day
// is kept, since transaction dates carry no time.
type camtDate struct {
	Date     string `xml:"Dt"`
	DateTime string `xml:"DtTm"`
}

func (d camtDate) civil() string {
	for _, v := range []string{d.Date, d.DateTime} {
		if v = strings.TrimSpace(v); len(v) >= 10 {
			return v[:10]
		}
	}
	return ""
}

type camtTxDetails struct {
	Refs       camtRefs    `xml:"Refs"`
	Parties    camtParties `xml:"RltdPties"`
	Remittance camtRmtInf  `xml:"RmtInf"`
	AddtlTxInf string      `xml:"AddtlTxInf"`
}

type camtRefs struct {
	AcctSvcrRef string `xml:"AcctSvcrRef"`
	EndToEndID  string `xml:"EndToEndId"`
	TxID        string `xml:"TxId"`
}

type camtParties struct {
	Creditor camtParty `xml:"Cdtr"`
	Debtor   camtParty `xml:"Dbtr"`
}

// camtParty holds the name directly in older versions and under <Pty> in newer
// ones.
type camtParty struct {
	Name    string `xml:"Nm"`
	PartyNm string `xml:"Pty>Nm"`
}

func (p camtParty) name() string {
	if n := strings.TrimSpace(p.Name); n != "" {
		return n
	}
	return strings.TrimSpace(p.PartyNm)
}

type camtRmtInf struct {
	Unstructured []string `xml:"Ustrd"`
	Structured   []string `xml:"Strd>AddtlRmtInf"`
}

func (r camtRmtInf) text() string {
	parts := make([]string, 0, len(r.Unstructured)+len(r.Structured))
	for _, v := range append(append([]string{}, r.Unstructured...), r.Structured...) {
		if v = strings.TrimSpace(v); v != "" {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, " ")
}

// ParseCAMT053 parses an ISO 20022 camt.053 statement into rows.
//
// Sign comes from CdtDbtInd, not from the amount: ISO 20022 amounts are always
// positive and the indicator carries the direction. The booking date is the
// transaction date (the value date is a settlement detail the register does not
// model). AcctSvcrRef — falling back to the end-to-end id — is recorded as the
// row's reference, so re-importing an overlapping statement flags the repeats
// instead of duplicating them.
func ParseCAMT053(content string) ([]Row, error) {
	if !strings.Contains(content, "BkToCstmrStmt") {
		return nil, fmt.Errorf("not a camt.053 statement")
	}
	var doc camtDocument
	dec := xml.NewDecoder(strings.NewReader(strings.TrimPrefix(content, "\ufeff")))
	// Banks export statements from Windows tooling, so a declared legacy
	// encoding is common; without a CharsetReader the decoder refuses the
	// document outright rather than reading it.
	dec.CharsetReader = camtCharsetReader
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("malformed XML: %w", err)
	}
	if len(doc.Statements) == 0 {
		return nil, fmt.Errorf("not a camt.053 statement")
	}

	// A statement is single-currency; anything else is a file we do not
	// understand, so those rows are flagged rather than silently converted.
	statementCcy := ""
	for _, st := range doc.Statements {
		for _, e := range st.Entries {
			if c := strings.TrimSpace(e.Amount.Currency); c != "" {
				statementCcy = c
				break
			}
		}
		if statementCcy != "" {
			break
		}
	}

	rows := make([]Row, 0)
	line := 0
	for _, st := range doc.Statements {
		for _, e := range st.Entries {
			line++
			rows = append(rows, camtRow(e, line, statementCcy))
		}
	}
	return rows, nil
}

func camtRow(e camtEntry, line int, statementCcy string) Row {
	row := Row{Line: line}

	// An entry batches one or more transactions. With exactly one the details
	// are unambiguous; with several, the per-transaction fields describe
	// different movements, so only the entry-level summary is trustworthy.
	var d camtTxDetails
	if len(e.Details) == 1 {
		d = e.Details[0]
	}

	row.Memo = d.Remittance.text()
	if row.Memo == "" {
		row.Memo = strings.TrimSpace(d.AddtlTxInf)
	}
	if row.Memo == "" {
		row.Memo = strings.TrimSpace(e.AddtlNtryInf)
	}

	row.FITID = firstNonEmpty(
		strings.TrimSpace(e.AcctSvcrRef),
		strings.TrimSpace(d.Refs.AcctSvcrRef),
		strings.TrimSpace(d.Refs.EndToEndID),
		strings.TrimSpace(d.Refs.TxID),
	)
	// NOTREPROVIDED is the ISO placeholder for "no end-to-end id"; treating it
	// as a reference would collapse every such row into one duplicate group.
	if strings.EqualFold(row.FITID, "NOTPROVIDED") {
		row.FITID = ""
	}

	row.Date = e.BookingDate.civil()
	if row.Date == "" {
		row.Date = e.ValueDate.civil()
	}
	if row.Date == "" {
		row.Err = "missing booking date"
		return row
	}

	credit, err := camtDirection(e.CdtDbtInd)
	if err != nil {
		row.Err = err.Error()
		return row
	}

	if ccy := strings.TrimSpace(e.Amount.Currency); ccy != "" && statementCcy != "" && ccy != statementCcy {
		row.Err = fmt.Sprintf("currency %s does not match the statement (%s)", ccy, statementCcy)
		return row
	}

	amt, err := parseAmountFlexible(strings.TrimSpace(e.Amount.Value), 6)
	if err != nil {
		row.Err = "invalid amount"
		return row
	}
	// ISO 20022 amounts are unsigned; a file that signs them anyway must not
	// have the sign applied twice.
	if amt < 0 {
		amt = -amt
	}
	if !credit {
		amt = -amt
	}
	row.Amount = amt

	// Only a booked entry is settled. A pending one can still change amount or
	// vanish, so it is imported with no status rather than marked cleared.
	if strings.EqualFold(e.Status.value(), "BOOK") {
		row.Status = 1 // Cleared
	}

	// The counterparty is whoever is on the other side of the movement.
	if credit {
		row.Payee = d.Parties.Debtor.name()
	} else {
		row.Payee = d.Parties.Creditor.name()
	}
	return row
}

// camtDirection reports whether the entry is money in (CRDT) or out (DBIT).
func camtDirection(ind string) (credit bool, err error) {
	switch strings.ToUpper(strings.TrimSpace(ind)) {
	case "CRDT":
		return true, nil
	case "DBIT":
		return false, nil
	case "":
		return false, fmt.Errorf("missing credit/debit indicator")
	default:
		return false, fmt.Errorf("unknown credit/debit indicator %q", ind)
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// cp1252High maps the 0x80-0x9F range, which is where windows-1252 differs from
// ISO-8859-1. The euro sign lives at 0x80, so it is not a range a statement
// parser can afford to approximate.
var cp1252High = [32]rune{
	'\u20ac', '\ufffd', '\u201a', '\u0192', '\u201e', '\u2026', '\u2020', '\u2021',
	'\u02c6', '\u2030', '\u0160', '\u2039', '\u0152', '\ufffd', '\u017d', '\ufffd',
	'\ufffd', '\u2018', '\u2019', '\u201c', '\u201d', '\u2022', '\u2013', '\u2014',
	'\u02dc', '\u2122', '\u0161', '\u203a', '\u0153', '\ufffd', '\u017e', '\u0178',
}

// camtCharsetReader transcodes the single-byte encodings banks actually emit.
// Anything else is refused rather than silently mangled.
func camtCharsetReader(charset string, input io.Reader) (io.Reader, error) {
	switch strings.ToLower(strings.TrimSpace(charset)) {
	case "", "utf-8", "utf8", "us-ascii", "ascii":
		return input, nil
	case "iso-8859-1", "iso8859-1", "latin1", "latin-1", "iso-8859-15", "windows-1252", "cp1252":
		raw, err := io.ReadAll(input)
		if err != nil {
			return nil, err
		}
		cp1252 := strings.HasPrefix(strings.ToLower(charset), "windows-1252") ||
			strings.EqualFold(charset, "cp1252")
		var buf bytes.Buffer
		buf.Grow(len(raw))
		for _, b := range raw {
			switch {
			case cp1252 && b >= 0x80 && b <= 0x9f:
				buf.WriteRune(cp1252High[b-0x80])
			default:
				buf.WriteRune(rune(b))
			}
		}
		return &buf, nil
	default:
		return nil, fmt.Errorf("unsupported encoding %q", charset)
	}
}
