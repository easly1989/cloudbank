package importio

import (
	"context"
	"errors"
	"testing"
)

const bankCSV = "Booking date;Description;Amount\n" +
	"03/10/2026;CARD PAYMENT MILANO;-42,30\n" +
	"\n" +
	"04/10/2026;SALARY;1500,00\n"

// A generic file's first preview hands back its columns, its first row and the
// mapping the wallet remembers for them; a different header has none.
func TestRememberedMapping(t *testing.T) {
	s, _, _, _, wid, acc := newTestService(t)
	ctx := context.Background()
	req := PreviewRequest{AccountID: acc, Content: bankCSV, Dialect: DialectGeneric, Delimiter: ";", HasHeader: true}

	pv, err := s.Preview(ctx, wid, req)
	if err != nil {
		t.Fatal(err)
	}
	if pv.Remembered != nil || len(pv.Sample) != 3 || pv.Sample[1] != "CARD PAYMENT MILANO" {
		t.Fatalf("first preview = %+v", pv)
	}

	m := CSVMapping{Mapping: map[string]int{"date": 0, "memo": 1, "amount": 2}, DateFormat: "dmy", DecimalChar: ","}
	if _, err := s.RememberMapping(ctx, wid, pv.Columns, CSVMapping{Mapping: map[string]int{"date": 3}, DecimalChar: "."}); !errors.Is(err, ErrBadMapping) {
		t.Fatalf("out of range: %v", err)
	}
	if _, err := s.RememberMapping(ctx, wid, pv.Columns, CSVMapping{Mapping: map[string]int{"date": 0, "memo": 0}, DecimalChar: "."}); !errors.Is(err, ErrBadMapping) {
		t.Fatalf("one column twice: %v", err)
	}
	kept, err := s.RememberMapping(ctx, wid, pv.Columns, m)
	if err != nil || kept.ID == 0 || kept.CreatedAt == "" {
		t.Fatalf("remember = %+v, %v", kept, err)
	}

	pv, err = s.Preview(ctx, wid, req)
	if err != nil {
		t.Fatal(err)
	}
	if r := pv.Remembered; r == nil || r.ID != kept.ID || r.Mapping["amount"] != 2 || r.DecimalChar != "," || r.DateFormat != "dmy" {
		t.Fatalf("remembered = %+v", pv.Remembered)
	}
	// Read with it: the blank line is skipped, the comma is the decimal mark.
	req.Mapping, req.DateFormat, req.DecimalChar = kept.Mapping, kept.DateFormat, kept.DecimalChar
	pv, err = s.Preview(ctx, wid, req)
	if err != nil || len(pv.Rows) != 2 || pv.Rows[0].Amount != -4230 || pv.Rows[0].Date != "2026-10-03" {
		t.Fatalf("mapped preview = %+v, %v", pv.Rows, err)
	}

	other := PreviewRequest{AccountID: acc, Content: "Date;Text;Value\n03/10/2026;CARD;-1,00\n", Dialect: DialectGeneric, Delimiter: ";", HasHeader: true}
	if pv, err := s.Preview(ctx, wid, other); err != nil || pv.Remembered != nil {
		t.Fatalf("other header = %+v, %v", pv.Remembered, err)
	}

	if err := s.ForgetMapping(ctx, wid, kept.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetMapping(ctx, wid, kept.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("forget twice: %v", err)
	}
}

func TestSample(t *testing.T) {
	cols, rows, err := Sample(bankCSV, ";", true, 3)
	if err != nil || len(cols) != 3 || len(rows) != 2 || rows[1][1] != "SALARY" {
		t.Fatalf("sample = %v %v %v", cols, rows, err)
	}
	cols, rows, _ = Sample("a,b\nc,d\n", "", false, 1)
	if cols[0] != "Column 1" || len(rows) != 1 || rows[0][0] != "a" {
		t.Fatalf("headerless = %v %v", cols, rows)
	}
}
