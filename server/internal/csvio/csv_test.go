package csvio

import "testing"

func TestParseHomeBank(t *testing.T) {
	content := "2026-01-15;3;ref1;Grocer;weekly shop;-12.34;Food:Groceries;food cash\n" +
		"2026-01-16;0;;Employer;salary;2000.00;Salary;\n"
	rows, err := Parse(content, ParseOptions{Dialect: DialectHomeBank})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	r := rows[0]
	if r.Date != "2026-01-15" || r.PaymentMode != 3 || r.Info != "ref1" || r.Payee != "Grocer" ||
		r.Memo != "weekly shop" || r.Amount != -12340000 /*6 frac*/ || r.Category != "Food:Groceries" {
		t.Fatalf("row0 = %+v", r)
	}
	if len(r.Tags) != 2 || r.Tags[0] != "food" || r.Tags[1] != "cash" {
		t.Fatalf("tags = %v", r.Tags)
	}
	if rows[1].Amount != 2000000000 {
		t.Fatalf("row1 amount = %d", rows[1].Amount)
	}
}

func TestParseRowErrorNotDropped(t *testing.T) {
	content := "notadate;0;;P;m;1.00;Cat;\n2026-02-02;0;;P;m;2.00;Cat;\n"
	rows, err := Parse(content, ParseOptions{Dialect: DialectHomeBank})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2 (bad row kept)", len(rows))
	}
	if rows[0].Err == "" {
		t.Fatalf("expected an error on row 0")
	}
	if rows[1].Err != "" {
		t.Fatalf("row 1 should be clean: %+v", rows[1])
	}
}

func TestParseGenericWithMapping(t *testing.T) {
	content := "Data,Importo,Beneficiario\n02/03/2026,\"1.234,56\",ACME\n"
	rows, err := Parse(content, ParseOptions{
		Dialect: DialectGeneric, Delimiter: ",", HasHeader: true, DateFormat: "dmy",
		DecimalChar: ",", Mapping: map[string]int{FieldDate: 0, FieldAmount: 1, FieldPayee: 2},
	})
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d", len(rows))
	}
	// 1.234,56 with comma decimal → 1234.56 → 6-frac = 1234560000
	if rows[0].Date != "2026-03-02" || rows[0].Amount != 1234560000 || rows[0].Payee != "ACME" {
		t.Fatalf("row = %+v", rows[0])
	}
}

func TestParseDate(t *testing.T) {
	cases := []struct{ in, format, want string }{
		{"2026-01-02", "iso", "2026-01-02"},
		{"2026/1/2", "iso", "2026-01-02"},
		{"02-01-2026", "dmy", "2026-01-02"},
		{"01-02-2026", "mdy", "2026-01-02"},
		{"31.12.2026", "dmy", "2026-12-31"},
		{"2026-01-02", "", "2026-01-02"},
	}
	for _, c := range cases {
		got, err := parseDate(c.in, c.format)
		if err != nil {
			t.Fatalf("parseDate(%q,%q): %v", c.in, c.format, err)
		}
		if got != c.want {
			t.Fatalf("parseDate(%q,%q) = %q, want %q", c.in, c.format, got, c.want)
		}
	}
	if _, err := parseDate("nonsense", "iso"); err == nil {
		t.Fatalf("expected error for nonsense date")
	}
}

func TestRescaleAmount(t *testing.T) {
	cases := []struct {
		in   int64
		frac int
		want int64
	}{
		{1234560000, 2, 123456}, // 1234.56 → cents
		{2000000000, 2, 200000}, // 2000.00
		{-12340000, 2, -1234},   // -12.34
		{1005000, 2, 101},       // 1.005 → 1.01 (half away from zero)
		{-1005000, 2, -101},     // -1.005 → -1.01
		{1234567, 0, 1},         // 1.234567 → 1
		{1234560000, 3, 1234560},
	}
	for _, c := range cases {
		if got := rescaleAmount(c.in, c.frac); got != c.want {
			t.Fatalf("rescaleAmount(%d,%d) = %d, want %d", c.in, c.frac, got, c.want)
		}
	}
}

func TestFormatHomeBankRoundTrip(t *testing.T) {
	rows := []ExportRow{
		{Date: "2026-01-15", PaymentMode: 3, Info: "ref", Payee: "Grocer; Inc", Memo: "shop",
			Amount: -1234, FracDigits: 2, Category: "Food:Groceries", Tags: []string{"food", "cash"}},
	}
	out, err := FormatHomeBankCSV(rows)
	if err != nil {
		t.Fatalf("FormatHomeBankCSV: %v", err)
	}
	// The payee contains the delimiter, so it must be quoted on round-trip.
	parsed, err := Parse(out, ParseOptions{Dialect: DialectHomeBank})
	if err != nil {
		t.Fatalf("re-Parse: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("parsed rows = %d", len(parsed))
	}
	p := parsed[0]
	if p.Payee != "Grocer; Inc" || p.Category != "Food:Groceries" || rescaleAmount(p.Amount, 2) != -1234 {
		t.Fatalf("round-trip row = %+v", p)
	}
}
