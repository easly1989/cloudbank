package importio

import (
	"bytes"
	"testing"
)

// A fabricated camt.053.001.02 statement — never a real one. It carries, in
// order: an outgoing payment with a creditor and unstructured remittance, an
// incoming one with a debtor, a pending entry, a batched entry with two
// transaction details, and an entry whose date is a timestamp.
const camtV02 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>FAKE-1</MsgId></GrpHdr>
    <Stmt>
      <Id>FAKE-STMT</Id>
      <Acct><Id><IBAN>IT00X0000000000000000000000</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="EUR">42.50</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-03-15</Dt></BookgDt>
        <ValDt><Dt>2026-03-16</Dt></ValDt>
        <AcctSvcrRef>REF-0001</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>E2E-0001</EndToEndId></Refs>
          <RltdPties><Cdtr><Nm>Panificio Rossi</Nm></Cdtr></RltdPties>
          <RmtInf><Ustrd>Pane e focaccia</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">1500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-03-01</Dt></BookgDt>
        <AcctSvcrRef>REF-0002</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties><Dbtr><Nm>Acme SpA</Nm></Dbtr></RltdPties>
          <RmtInf><Ustrd>Stipendio</Ustrd><Ustrd>marzo</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">9.99</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>PDNG</Sts>
        <BookgDt><Dt>2026-03-20</Dt></BookgDt>
        <AddtlNtryInf>Pagamento in attesa</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">30.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-03-18</Dt></BookgDt>
        <AcctSvcrRef>REF-0004</AcctSvcrRef>
        <AddtlNtryInf>Addebiti raggruppati</AddtlNtryInf>
        <NtryDtls>
          <TxDtls><RltdPties><Cdtr><Nm>Primo</Nm></Cdtr></RltdPties></TxDtls>
          <TxDtls><RltdPties><Cdtr><Nm>Secondo</Nm></Cdtr></RltdPties></TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="EUR">5.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><DtTm>2026-03-22T10:30:00+01:00</DtTm></BookgDt>
        <AcctSvcrRef>REF-0005</AcctSvcrRef>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`

func TestParseCAMT053(t *testing.T) {
	rows, err := ParseCAMT053(camtV02)
	if err != nil {
		t.Fatalf("ParseCAMT053: %v", err)
	}
	if len(rows) != 5 {
		t.Fatalf("rows = %d, want 5", len(rows))
	}

	// Amounts are 6-decimal fixed point; processRows rescales to the account.
	out := rows[0]
	if out.Date != "2026-03-15" {
		t.Errorf("date = %q, want the booking date 2026-03-15", out.Date)
	}
	if out.Amount != -42_500_000 {
		t.Errorf("amount = %d, want -42500000 (a debit is negative)", out.Amount)
	}
	if out.Payee != "Panificio Rossi" {
		t.Errorf("payee = %q, want the creditor on a debit", out.Payee)
	}
	if out.Memo != "Pane e focaccia" {
		t.Errorf("memo = %q", out.Memo)
	}
	if out.FITID != "REF-0001" {
		t.Errorf("FITID = %q, want the account servicer reference", out.FITID)
	}
	if out.Status != 1 {
		t.Errorf("status = %d, want 1 (booked is cleared)", out.Status)
	}

	in := rows[1]
	if in.Amount != 1_500_000_000 {
		t.Errorf("amount = %d, want 1500000000 (a credit is positive)", in.Amount)
	}
	if in.Payee != "Acme SpA" {
		t.Errorf("payee = %q, want the debtor on a credit", in.Payee)
	}
	if in.Memo != "Stipendio marzo" {
		t.Errorf("memo = %q, want both Ustrd lines joined", in.Memo)
	}

	pending := rows[2]
	if pending.Status != 0 {
		t.Errorf("status = %d, want 0: a pending entry is not settled", pending.Status)
	}
	if pending.Memo != "Pagamento in attesa" {
		t.Errorf("memo = %q, want the entry-level AddtlNtryInf", pending.Memo)
	}
	if pending.FITID != "" {
		t.Errorf("FITID = %q, want empty when the bank gave no reference", pending.FITID)
	}

	// A batched entry describes several movements, so no single payee applies.
	batch := rows[3]
	if batch.Payee != "" {
		t.Errorf("payee = %q, want empty for a batched entry", batch.Payee)
	}
	if batch.Amount != -30_000_000 {
		t.Errorf("amount = %d, want the entry total", batch.Amount)
	}
	if batch.Memo != "Addebiti raggruppati" {
		t.Errorf("memo = %q", batch.Memo)
	}

	if rows[4].Date != "2026-03-22" {
		t.Errorf("date = %q, want the calendar day of a DtTm", rows[4].Date)
	}
}

func TestParseCAMT053NewerVersionShapes(t *testing.T) {
	// camt.053.001.08 nests the status code and the party name one level deeper,
	// and uses a different namespace. Local-name matching must absorb all three.
	const v08 = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt><Stmt><Ntry>
    <Amt Ccy="EUR">12.34</Amt>
    <CdtDbtInd>DBIT</CdtDbtInd>
    <Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-04-02</Dt></BookgDt>
    <NtryDtls><TxDtls>
      <Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
      <RltdPties><Cdtr><Pty><Nm>Libreria Bianchi</Nm></Pty></Cdtr></RltdPties>
      <RmtInf><Ustrd>Libri</Ustrd></RmtInf>
    </TxDtls></NtryDtls>
  </Ntry></Stmt></BkToCstmrStmt>
</Document>`
	rows, err := ParseCAMT053(v08)
	if err != nil {
		t.Fatalf("ParseCAMT053: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	r := rows[0]
	if r.Status != 1 {
		t.Errorf("status = %d, want 1: <Sts><Cd>BOOK</Cd></Sts> is still booked", r.Status)
	}
	if r.Payee != "Libreria Bianchi" {
		t.Errorf("payee = %q, want the name under <Pty>", r.Payee)
	}
	if r.Amount != -12_340_000 {
		t.Errorf("amount = %d", r.Amount)
	}
	// NOTPROVIDED is a placeholder, not an id: keeping it would collapse every
	// such row into one duplicate group.
	if r.FITID != "" {
		t.Errorf("FITID = %q, want empty for the NOTPROVIDED placeholder", r.FITID)
	}
}

func TestParseCAMT053AcceptsBOMAndLegacyEncodings(t *testing.T) {
	// A statement exported from Windows tooling: UTF-8 BOM in front of the
	// declaration. Without stripping it the decoder rejects the whole document.
	if rows, err := ParseCAMT053(string(rune(0xFEFF)) + camtV02); err != nil {
		t.Errorf("UTF-8 BOM: %v", err)
	} else if len(rows) != 5 {
		t.Errorf("UTF-8 BOM: rows = %d, want 5", len(rows))
	}

	// ISO-8859-1 on the wire: the accented byte is 0xE0, not a UTF-8 sequence.
	latin1 := []byte(`<?xml version="1.0" encoding="ISO-8859-1"?>
<Document><BkToCstmrStmt><Stmt><Ntry>
  <Amt Ccy="EUR">1.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
  <BookgDt><Dt>2026-07-01</Dt></BookgDt>
  <AddtlNtryInf>CITTA</AddtlNtryInf>
</Ntry></Stmt></BkToCstmrStmt></Document>`)
	latin1[bytes.LastIndex(latin1, []byte("CITTA"))+4] = 0xE0 // "CITTà"
	rows, err := ParseCAMT053(string(latin1))
	if err != nil {
		t.Fatalf("ISO-8859-1: %v", err)
	}
	if rows[0].Memo != "CITTà" {
		t.Errorf("ISO-8859-1 memo = %q, want %q", rows[0].Memo, "CITTà")
	}

	// windows-1252 differs from latin-1 exactly where the euro sign lives.
	cp1252 := []byte(`<?xml version="1.0" encoding="windows-1252"?>
<Document><BkToCstmrStmt><Stmt><Ntry>
  <Amt Ccy="EUR">1.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>
  <BookgDt><Dt>2026-07-02</Dt></BookgDt>
  <AddtlNtryInf>X 10</AddtlNtryInf>
</Ntry></Stmt></BkToCstmrStmt></Document>`)
	cp1252[bytes.LastIndex(cp1252, []byte("X 10"))] = 0x80 // the euro sign
	rows, err = ParseCAMT053(string(cp1252))
	if err != nil {
		t.Fatalf("windows-1252: %v", err)
	}
	if rows[0].Memo != "€ 10" {
		t.Errorf("windows-1252 memo = %q, want %q", rows[0].Memo, "€ 10")
	}

	// An encoding we cannot honestly transcode is refused, not mangled.
	if _, err := ParseCAMT053(`<?xml version="1.0" encoding="Shift_JIS"?>
<Document><BkToCstmrStmt><Stmt><Ntry/></Stmt></BkToCstmrStmt></Document>`); err == nil {
		t.Error("Shift_JIS: expected an error")
	}
}

func TestParseCAMT053Rejects(t *testing.T) {
	for _, tc := range []struct{ name, in string }{
		{"empty", ""},
		{"not camt", `<Document><Foo/></Document>`},
		{"ofx instead", "<OFX><STMTTRN></STMTTRN></OFX>"},
		{"truncated", `<Document><BkToCstmrStmt><Stmt><Ntry>`},
	} {
		if _, err := ParseCAMT053(tc.in); err == nil {
			t.Errorf("%s: expected an error", tc.name)
		}
	}
}

func TestParseCAMT053FlagsBadEntries(t *testing.T) {
	const bad = `<Document><BkToCstmrStmt><Stmt>
  <Ntry><Amt Ccy="EUR">1.00</Amt><Sts>BOOK</Sts><BookgDt><Dt>2026-05-01</Dt></BookgDt></Ntry>
  <Ntry><Amt Ccy="EUR">2.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts></Ntry>
  <Ntry><Amt Ccy="USD">3.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-05-03</Dt></BookgDt></Ntry>
  <Ntry><Amt Ccy="EUR">nope</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-05-04</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`
	rows, err := ParseCAMT053(bad)
	if err != nil {
		t.Fatalf("ParseCAMT053: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("rows = %d, want 4: a bad entry is flagged, never dropped", len(rows))
	}
	// In entry order: no indicator, no date, a foreign currency, a bad amount.
	for i, want := range []string{
		"missing credit/debit indicator",
		"missing booking date",
		"currency USD does not match the statement (EUR)",
		"invalid amount",
	} {
		if rows[i].Err != want {
			t.Errorf("row %d err = %q, want %q", i, rows[i].Err, want)
		}
	}
}

func TestParseCAMT053UsesValueDateAsFallback(t *testing.T) {
	const noBookingDate = `<Document><BkToCstmrStmt><Stmt><Ntry>
    <Amt Ccy="EUR">7.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <ValDt><Dt>2026-06-09</Dt></ValDt>
  </Ntry></Stmt></BkToCstmrStmt></Document>`
	rows, err := ParseCAMT053(noBookingDate)
	if err != nil {
		t.Fatalf("ParseCAMT053: %v", err)
	}
	if rows[0].Date != "2026-06-09" {
		t.Errorf("date = %q, want the value date when there is no booking date", rows[0].Date)
	}
	if rows[0].Err != "" {
		t.Errorf("err = %q, want none", rows[0].Err)
	}
}
