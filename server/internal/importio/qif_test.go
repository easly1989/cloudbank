package importio

import "testing"

const sampleQIF = `!Type:Bank
D2026-01-15
T-12.34
PGrocer
MWeekly shop
LFood:Groceries
N123
^
D2026-01-16
T1.500,00
PEmployer
LSalary
^
D2026-01-17
T-100.00
PLandlord
L[Savings]
MRent
^
D2026-01-18
T-30.00
PStore
SFood
$-20.00
SHousehold
$-10.00
^
`

func TestParseQIF(t *testing.T) {
	rows, err := ParseQIF(sampleQIF, "")
	if err != nil {
		t.Fatalf("ParseQIF: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("rows = %d, want 4", len(rows))
	}

	// Plain expense with category and check number.
	r0 := rows[0]
	if r0.Date != "2026-01-15" || r0.Amount != -12340000 || r0.Payee != "Grocer" ||
		r0.Memo != "Weekly shop" || r0.Category != "Food:Groceries" || r0.Info != "123" {
		t.Fatalf("row0 = %+v", r0)
	}

	// Decimal-comma amount: 1.500,00 → 1500.00.
	if rows[1].Amount != 1500000000 {
		t.Fatalf("row1 amount = %d, want 1500000000", rows[1].Amount)
	}

	// Transfer: category cleared, target noted in the memo.
	r2 := rows[2]
	if r2.Category != "" || r2.Memo != "Rent (Transfer: Savings)" {
		t.Fatalf("row2 transfer = %+v", r2)
	}

	// Multi-split: total kept, category empty, split noted.
	r3 := rows[3]
	if r3.Amount != -30000000 || r3.Category != "" || r3.Memo != "split" {
		t.Fatalf("row3 split = %+v", r3)
	}
}

func TestParseQIFSingleSplitBecomesCategory(t *testing.T) {
	qif := "!Type:Bank\nD2026-02-01\nT-5.00\nPShop\nSGroceries\n$-5.00\n^\n"
	rows, err := ParseQIF(qif, "")
	if err != nil {
		t.Fatalf("ParseQIF: %v", err)
	}
	if len(rows) != 1 || rows[0].Category != "Groceries" {
		t.Fatalf("rows = %+v", rows)
	}
}

func TestFormatQIFRoundTrip(t *testing.T) {
	rows := []QIFExportRow{
		{Date: "2026-01-15", Amount: -1234, FracDigits: 2, Payee: "Grocer", Memo: "shop", Category: "Food:Groceries", Info: "123"},
		{Date: "2026-01-16", Amount: 150000, FracDigits: 2, Payee: "Employer", Category: "Salary"},
	}
	out := FormatQIF("bank", rows)
	parsed, err := ParseQIF(out, "")
	if err != nil {
		t.Fatalf("re-ParseQIF: %v", err)
	}
	if len(parsed) != 2 {
		t.Fatalf("parsed = %d, want 2", len(parsed))
	}
	if rescaleAmount(parsed[0].Amount, 2) != -1234 || parsed[0].Category != "Food:Groceries" ||
		parsed[0].Payee != "Grocer" || parsed[0].Info != "123" {
		t.Fatalf("round-trip row0 = %+v", parsed[0])
	}
	if rescaleAmount(parsed[1].Amount, 2) != 150000 {
		t.Fatalf("round-trip row1 amount = %d", parsed[1].Amount)
	}
}

func TestQIFTypeForAccount(t *testing.T) {
	cases := map[string]string{
		"bank": "Bank", "cash": "Cash", "creditcard": "CCard",
		"asset": "Oth A", "liability": "Oth L", "weird": "Bank",
	}
	for in, want := range cases {
		if got := qifTypeForAccount(in); got != want {
			t.Fatalf("qifTypeForAccount(%q) = %q, want %q", in, got, want)
		}
	}
}
