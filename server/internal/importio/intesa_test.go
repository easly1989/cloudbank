package importio

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"testing"
)

// cellVal is a spreadsheet cell: a string (shared) or a number.
type cellVal struct {
	s      string
	n      float64
	number bool
}

func str(s string) cellVal  { return cellVal{s: s} }
func num(n float64) cellVal { return cellVal{n: n, number: true} }
func blank() cellVal        { return cellVal{} }

// buildXLSX writes a minimal .xlsx (shared strings + one sheet) from a grid,
// mirroring how Intesa's export is structured, so we can test the parser without
// committing a real (personal) bank statement.
func buildXLSX(t *testing.T, grid [][]cellVal) []byte {
	t.Helper()
	// Collect shared strings.
	idx := map[string]int{}
	var shared []string
	sidFor := func(s string) int {
		if id, ok := idx[s]; ok {
			return id
		}
		id := len(shared)
		idx[s] = id
		shared = append(shared, s)
		return id
	}
	var sheet bytes.Buffer
	sheet.WriteString(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for r, row := range grid {
		fmt.Fprintf(&sheet, `<row r="%d">`, r+1)
		for c, cv := range row {
			ref := colName(c) + strconv.Itoa(r+1)
			switch {
			case cv.number:
				fmt.Fprintf(&sheet, `<c r="%s"><v>%s</v></c>`, ref, strconv.FormatFloat(cv.n, 'f', -1, 64))
			case cv.s != "":
				fmt.Fprintf(&sheet, `<c r="%s" t="s"><v>%d</v></c>`, ref, sidFor(cv.s))
			}
		}
		sheet.WriteString(`</row>`)
	}
	sheet.WriteString(`</sheetData></worksheet>`)

	var ss bytes.Buffer
	ss.WriteString(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
	for _, s := range shared {
		ss.WriteString("<si><t>")
		_ = xml.EscapeText(&ss, []byte(s))
		ss.WriteString("</t></si>")
	}
	ss.WriteString("</sst>")

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range map[string][]byte{
		"xl/sharedStrings.xml":     ss.Bytes(),
		"xl/worksheets/sheet1.xml": sheet.Bytes(),
	} {
		f, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func colName(c int) string {
	name := ""
	for c >= 0 {
		name = string(rune('A'+c%26)) + name
		c = c/26 - 1
	}
	return name
}

func TestParseIntesaXLSX(t *testing.T) {
	grid := [][]cellVal{
		{blank(), blank(), str("Intestatario conto:"), str("MARIO ROSSI")},
		{blank(), blank(), str("Numero conto:"), str("100000000000")},
		{blank(), blank(), blank(), str("Operazioni contabilizzate")},
		{str("Data contabile"), str("Data valuta"), str("Descrizione"), str("Accrediti"), str("Addebiti"), str("Descrizione estesa"), str("Effettuata tramite:")},
		{blank(), blank(), str("Saldo contabile iniziale in Euro"), blank(), num(7142.96)},
		// posted debit (POS)
		{num(46189), num(46184), str("PAGAMENTO POS"), blank(), num(-50.0), str("EFFETTUATO IL 11/06/2026 PRESSO CAF")},
		// posted credit (salary)
		{num(46206), num(46206), str("STIPENDIO O PENSIONE"), num(2617.0), blank(), str("RETRIBUZIONE")},
		{blank(), blank(), str("Saldo contabile finale in Euro"), blank(), num(5356.13)},
		{blank(), blank(), blank(), str("Operazioni non contabilizzate")},
		{blank(), str("Data"), str("Descrizione"), str("Accrediti"), str("Addebiti"), str("Descrizione estesa")},
		// pending debit (shifted date column B)
		{blank(), num(46216), str("PAGAMENTO EFFETTUATO SU POS ESTERO"), blank(), num(-11.26), str("Cino/AMZN Mktp IT")},
	}
	rows, err := ParseIntesaXLSX(buildXLSX(t, grid))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("want 3 movements, got %d: %+v", len(rows), rows)
	}

	// r0 — posted POS debit
	if rows[0].Date != "2026-06-16" {
		t.Errorf("r0 date = %q, want 2026-06-16", rows[0].Date)
	}
	if rows[0].Amount != -50_000_000 { // 6-decimal fixed point
		t.Errorf("r0 amount = %d, want -50000000", rows[0].Amount)
	}
	if rows[0].Memo != "EFFETTUATO IL 11/06/2026 PRESSO CAF" || rows[0].Info != "PAGAMENTO POS" {
		t.Errorf("r0 memo/info = %q / %q", rows[0].Memo, rows[0].Info)
	}
	if rows[0].Status != 1 {
		t.Errorf("r0 status = %d, want 1 (Cleared)", rows[0].Status)
	}
	if rows[0].PaymentMode != 6 {
		t.Errorf("r0 paymode = %d, want 6 (debit card)", rows[0].PaymentMode)
	}
	if rows[0].FITID == "" {
		t.Errorf("r0 missing import ref")
	}

	// r1 — posted credit
	if rows[1].Date != "2026-07-03" || rows[1].Amount != 2_617_000_000 {
		t.Errorf("r1 date/amount = %q / %d", rows[1].Date, rows[1].Amount)
	}

	// r2 — pending (date read from column B), the AMZN example
	if rows[2].Date != "2026-07-13" {
		t.Errorf("r2 date = %q, want 2026-07-13", rows[2].Date)
	}
	if rows[2].Amount != -11_260_000 || rows[2].Memo != "Cino/AMZN Mktp IT" || rows[2].Status != 1 {
		t.Errorf("r2 = %+v", rows[2])
	}

	// Re-import fingerprints are stable and unique per row.
	if rows[0].FITID == rows[2].FITID {
		t.Errorf("import refs should differ across rows")
	}
	again, _ := ParseIntesaXLSX(buildXLSX(t, grid))
	if again[0].FITID != rows[0].FITID {
		t.Errorf("import ref not stable across parses")
	}
}

func TestParseIntesaXLSX_NotAnXLSX(t *testing.T) {
	if _, err := ParseIntesaXLSX([]byte("not a zip")); err == nil {
		t.Fatal("expected an error for non-xlsx input")
	}
}
