package importio

import (
	"archive/zip"
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ParseIntesaXLSX parses an Intesa Sanpaolo "Movimenti Conto" .xlsx export into
// import rows. The sheet has two sections with slightly different layouts:
//
//	Operazioni contabilizzate (posted):
//	  A Data contabile | B Data valuta | C Descrizione | D Accrediti | E Addebiti | F Descrizione estesa | G Effettuata tramite
//	Operazioni non contabilizzate (pending):
//	  A (blank) | B Data | C Descrizione | D Accrediti | E Addebiti | F Descrizione estesa
//
// Dates are Excel serial numbers (integer part = the day). Amount = Accrediti
// (credit, +) or Addebiti (debit, −). Both sections import as Cleared (status 1)
// so they can be edited/reconciled later. Each row gets a stable ImportRef so a
// re-import of the same export is de-duplicated. (Reconciling a pending row to
// its later posted form — where the description changes — is a follow-up.)
func ParseIntesaXLSX(content []byte) ([]Row, error) {
	cells, err := readXLSXGrid(content)
	if err != nil {
		return nil, err
	}
	if len(cells) == 0 {
		return nil, fmt.Errorf("intesa: empty spreadsheet")
	}

	const (
		colDataContabile = 0 // A
		colDataValuta    = 1 // B
		colDescrizione   = 2 // C
		colAccrediti     = 3 // D
		colAddebiti      = 4 // E
		colEstesa        = 5 // F
	)

	rows := make([]Row, 0)
	section := "" // "posted" | "pending"
	line := 0
	for _, r := range cells {
		line++
		joined := strings.ToLower(strings.Join(r, " "))
		switch {
		case strings.Contains(joined, "operazioni non contabilizzate"):
			section = "pending"
			continue
		case strings.Contains(joined, "operazioni contabilizzate"):
			section = "posted"
			continue
		}
		if section == "" || strings.Contains(joined, "saldo contabile") {
			continue // header block, section titles, opening/closing balance rows
			// NB: match the specific balance phrase, not any "saldo" — a real
			// transaction description may contain the word "saldo".
		}
		// The pending section's data columns are shifted one to the right (its
		// single "Data" is in column B, not A).
		dateCol := colDataContabile
		if section == "pending" {
			dateCol = colDataValuta
		}
		date, okD := excelSerialToISO(cell(r, dateCol))
		var amount int64
		haveAmount := false
		if s := strings.TrimSpace(cell(r, colAccrediti)); s != "" {
			if v, err := parseAmountFlexible(s, 6); err == nil {
				amount, haveAmount = v, true
			}
		}
		if !haveAmount {
			if s := strings.TrimSpace(cell(r, colAddebiti)); s != "" {
				if v, err := parseAmountFlexible(s, 6); err == nil {
					amount, haveAmount = v, true
				}
			}
		}
		// A data row needs a valid date and a credit or debit amount.
		if !okD || !haveAmount {
			continue // header row, blank row, etc.
		}
		desc := strings.TrimSpace(cell(r, colDescrizione))
		estesa := strings.TrimSpace(cell(r, colEstesa))
		// A settled (posted) row carries a MatchDate — its real purchase date,
		// from "EFFETTUATO IL DD/MM/YYYY" when present, else the value date — so
		// it can be reconciled against a previously-imported pending row (whose
		// stored date is that value date). Pending rows are the reconcile targets
		// and don't themselves reconcile.
		matchDate := ""
		if section == "posted" {
			if pd, ok := effettuatoDate(estesa); ok {
				matchDate = pd
			} else if vd, ok := excelSerialToISO(cell(r, colDataValuta)); ok {
				matchDate = vd
			} else {
				matchDate = date
			}
		}
		rows = append(rows, Row{
			Line:        line,
			Date:        date,
			Amount:      amount,
			PaymentMode: intesaPaymentMode(desc),
			Info:        desc,
			Memo:        estesa,
			Status:      1, // Cleared / "Non riconciliata"
			MatchDate:   matchDate,
			FITID:       intesaRef(section, date, amount, estesa),
		})
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("intesa: no movements found — is this an Intesa Sanpaolo export?")
	}
	return rows, nil
}

// intesaRef is a stable per-row fingerprint used to de-duplicate a re-import of
// the same export. It intentionally includes the (section-specific) extended
// description, so an identical row is matched but genuinely different same-day/
// same-amount rows are not. The section is also in the ref prefix
// ("intesa:pending:" / "intesa:posted:") so a settled row can find the pending
// rows to reconcile.
func intesaRef(section, date string, amount int64, estesa string) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("intesa|%s|%s|%d|%s", section, date, amount, estesa)))
	return "intesa:" + section + ":" + hex.EncodeToString(sum[:])[:16]
}

var effettuatoRe = regexp.MustCompile(`EFFETTUATO IL (\d{2})/(\d{2})/(\d{4})`)

// effettuatoDate extracts the purchase date from a POS extended description
// ("EFFETTUATO IL DD/MM/YYYY …") as YYYY-MM-DD.
func effettuatoDate(estesa string) (string, bool) {
	m := effettuatoRe.FindStringSubmatch(estesa)
	if m == nil {
		return "", false
	}
	return m[3] + "-" + m[2] + "-" + m[1], true
}

// intesaPaymentMode maps the Intesa operation type to a HomeBank payment mode.
func intesaPaymentMode(desc string) int {
	d := strings.ToUpper(desc)
	switch {
	case strings.Contains(d, "POS"):
		return 6 // debit card
	case strings.Contains(d, "ADUE"), strings.Contains(d, "ADDEBITO"), strings.Contains(d, "SDD"):
		return 11 // direct debit
	case strings.Contains(d, "BONIFICO"):
		return 4 // transfer
	case strings.Contains(d, "STIPENDIO"), strings.Contains(d, "PENSIONE"):
		return 4
	default:
		return 0
	}
}

var excelSerialRe = regexp.MustCompile(`^-?\d+(\.\d+)?$`)

// excelSerialToISO converts an Excel date serial (days since 1899-12-30, with an
// optional fractional time part we ignore) to a YYYY-MM-DD string.
func excelSerialToISO(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" || !excelSerialRe.MatchString(s) {
		return "", false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 1 || f > 2958465 { // 1..9999-12-31
		return "", false
	}
	base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	return base.AddDate(0, 0, int(f)).Format("2006-01-02"), true
}

func cell(row []string, i int) string {
	if i < len(row) {
		return row[i]
	}
	return ""
}

// --- Minimal OOXML (.xlsx) reader -----------------------------------------
// Reads the first worksheet into a dense grid of string cell values, resolving
// shared strings. No external dependency.

func readXLSXGrid(content []byte) ([][]string, error) {
	zr, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, fmt.Errorf("intesa: not a valid .xlsx file: %w", err)
	}
	files := map[string]*zip.File{}
	var sheetName string
	for _, f := range zr.File {
		files[f.Name] = f
		if sheetName == "" && strings.HasPrefix(f.Name, "xl/worksheets/sheet") && strings.HasSuffix(f.Name, ".xml") {
			sheetName = f.Name
		}
	}
	if sheetName == "" {
		return nil, fmt.Errorf("intesa: no worksheet in the .xlsx file")
	}

	shared, err := readSharedStrings(files["xl/sharedStrings.xml"])
	if err != nil {
		return nil, err
	}
	return readSheet(files[sheetName], shared)
}

func readSharedStrings(f *zip.File) ([]string, error) {
	if f == nil {
		return nil, nil
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()

	var out []string
	dec := xml.NewDecoder(rc)
	var cur strings.Builder
	inSI, inT := false, false
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "si":
				inSI = true
				cur.Reset()
			case "t":
				inT = true
			}
		case xml.CharData:
			if inSI && inT {
				cur.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inT = false
			case "si":
				inSI = false
				out = append(out, cur.String())
			}
		}
	}
	return out, nil
}

func readSheet(f *zip.File, shared []string) ([][]string, error) {
	if f == nil {
		return nil, fmt.Errorf("intesa: worksheet not found")
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()

	var grid [][]string
	dec := xml.NewDecoder(rc)
	var rowCells map[int]string
	var maxCol int
	// current cell state
	var cellRef, cellType string
	var val strings.Builder
	inV, inCellT := false, false

	flushRow := func() {
		row := make([]string, maxCol)
		for i := range row {
			row[i] = rowCells[i]
		}
		grid = append(grid, row)
	}

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				rowCells = map[int]string{}
				maxCol = 0
			case "c":
				cellRef, cellType = "", ""
				for _, a := range t.Attr {
					switch a.Name.Local {
					case "r":
						cellRef = a.Value
					case "t":
						cellType = a.Value
					}
				}
				val.Reset()
			case "v":
				inV = true
			case "t":
				inCellT = true
			}
		case xml.CharData:
			if inV || inCellT {
				val.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "v":
				inV = false
			case "t":
				inCellT = false
			case "c":
				raw := val.String()
				text := raw
				if cellType == "s" { // shared string index
					if idx, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && idx >= 0 && idx < len(shared) {
						text = shared[idx]
					} else {
						text = ""
					}
				}
				col := colIndex(cellRef)
				if col >= 0 {
					rowCells[col] = text
					if col+1 > maxCol {
						maxCol = col + 1
					}
				}
			case "row":
				flushRow()
			}
		}
	}
	return grid, nil
}

// colIndex turns a cell ref like "AB12" into a 0-based column index.
func colIndex(ref string) int {
	col := 0
	for _, ch := range ref {
		if ch >= 'A' && ch <= 'Z' {
			col = col*26 + int(ch-'A'+1)
		} else if ch >= 'a' && ch <= 'z' {
			col = col*26 + int(ch-'a'+1)
		} else {
			break
		}
	}
	return col - 1
}
