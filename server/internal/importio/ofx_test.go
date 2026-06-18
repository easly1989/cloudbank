package importio

import "testing"

const sampleOFXSGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260115120000.000[-5:EST]
<TRNAMT>-12.34
<FITID>ABC123
<NAME>Grocer
<MEMO>Weekly shop
</STMTTRN>
<STMTTRN>
<TRNTYPE>CHECK
<DTPOSTED>20260116
<TRNAMT>1500.00
<FITID>DEF456
<NAME>Employer
<CHECKNUM>987
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`

const sampleOFXXML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="200" SECURITY="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260115</DTPOSTED><TRNAMT>-12.34</TRNAMT><FITID>ABC123</FITID><NAME>Grocer</NAME><MEMO>Weekly shop</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`

func TestParseOFXSGML(t *testing.T) {
	rows, err := ParseOFX(sampleOFXSGML)
	if err != nil {
		t.Fatalf("ParseOFX: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	r0 := rows[0]
	if r0.Date != "2026-01-15" || r0.Amount != -12340000 || r0.Payee != "Grocer" ||
		r0.Memo != "Weekly shop" || r0.FITID != "ABC123" {
		t.Fatalf("row0 = %+v", r0)
	}
	r1 := rows[1]
	if r1.Date != "2026-01-16" || r1.Amount != 1500000000 || r1.FITID != "DEF456" ||
		r1.Info != "987" || r1.PaymentMode != 2 /* CHECK */ {
		t.Fatalf("row1 = %+v", r1)
	}
}

func TestParseOFXXML(t *testing.T) {
	rows, err := ParseOFX(sampleOFXXML)
	if err != nil {
		t.Fatalf("ParseOFX: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	r := rows[0]
	if r.Date != "2026-01-15" || r.Amount != -12340000 || r.Payee != "Grocer" ||
		r.Memo != "Weekly shop" || r.FITID != "ABC123" {
		t.Fatalf("row = %+v", r)
	}
}

func TestParseOFXRejectsNonOFX(t *testing.T) {
	if _, err := ParseOFX("just some text"); err == nil {
		t.Fatalf("expected an error for non-OFX content")
	}
}

func TestParseOFXDate(t *testing.T) {
	cases := map[string]string{
		"20260115":              "2026-01-15",
		"20260229120000":        "2026-02-29",
		"20251231235959.000[0]": "2025-12-31",
	}
	for in, want := range cases {
		got, err := parseOFXDate(in)
		if err != nil {
			t.Fatalf("parseOFXDate(%q): %v", in, err)
		}
		if got != want {
			t.Fatalf("parseOFXDate(%q) = %q, want %q", in, got, want)
		}
	}
	if _, err := parseOFXDate("2026"); err == nil {
		t.Fatalf("expected error for short date")
	}
}
