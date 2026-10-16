package mailingest

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// A notification built on the shape of an Italian bank's card-payment mail,
// with made-up data: never a real mail.
const (
	bankSender  = "avvisi@banca.example"
	bankSubject = "Pagamento con carta"
	bankBody    = "Gentile cliente, ti informiamo che in data 10.15 è stato richiesto un pagamento di 6,43 EUR " +
		"con la carta 1234_*_*_5678 presso Supermercato Demo 0042, - 10.15 ore 17:56"
	// What the editor would generate after highlighting the amount and the memo.
	bankExpr = `pagamento di (?P<amount>[\d.,]+) EUR con la carta \S+ presso (?P<memo>.+?), -`
)

var rome = time.FixedZone("CEST", 2*3600)

func bankMail() mailInput {
	return mailInput{
		From: bankSender, Subject: bankSubject, Body: bankBody,
		Date: time.Date(2026, 10, 15, 17, 56, 30, 0, rome), Authenticated: true,
	}
}

func basePattern() Pattern {
	return Pattern{
		Sender: bankSender, Body: bankExpr, AccountID: 7, Direction: DirectionOut,
		PaymentMode: 4, ApplyRules: true, RequireAuth: true,
	}
}

func euros(int64) (int, bool) { return 2, true }

func mustCompile(t *testing.T, p Pattern) *compiled {
	t.Helper()
	c, err := compile(p)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestPatternReadsTheBankMail(t *testing.T) {
	c := mustCompile(t, basePattern())
	ev := evaluate([]*compiled{c}, bankMail(), euros)
	if ev.outcome != "" || ev.err != nil {
		t.Fatalf("evaluation = %+v", ev)
	}
	tx := ev.tx
	if tx.Amount != -643 || tx.Memo != "Supermercato Demo 0042" || tx.AccountID != 7 || tx.PaymentMode != 4 {
		t.Fatalf("transaction = %+v", tx)
	}
	// The date is the mail's, as a calendar day where it was written.
	if tx.Date != "2026-10-15" {
		t.Fatalf("date = %q", tx.Date)
	}
}

func TestPatternDateIsTheDayInTheHeadersOwnOffset(t *testing.T) {
	m := bankMail()
	// 00:30 in Rome on the 16th is still the 15th in UTC: the mail's own day wins.
	m.Date = time.Date(2026, 10, 16, 0, 30, 0, 0, rome)
	ev := evaluate([]*compiled{mustCompile(t, basePattern())}, m, euros)
	if ev.tx.Date != "2026-10-16" {
		t.Fatalf("date = %q, want the 16th", ev.tx.Date)
	}
}

func TestPatternAppliesOnlyToItsSenderAndSubject(t *testing.T) {
	p := basePattern()
	p.SubjectMode, p.Subject = "contains", "pagamento"
	c := mustCompile(t, p)

	other := bankMail()
	other.From = "someone@else.example"
	if ev := evaluate([]*compiled{c}, other, euros); ev.outcome != OutcomeUnrecognized {
		t.Fatalf("another sender: %+v", ev)
	}
	other = bankMail()
	other.Subject = "Bonifico in arrivo"
	if ev := evaluate([]*compiled{c}, other, euros); ev.outcome != OutcomeUnrecognized {
		t.Fatalf("another subject: %+v", ev)
	}
	upper := bankMail()
	upper.From = "AVVISI@Banca.Example"
	if ev := evaluate([]*compiled{c}, upper, euros); ev.outcome != "" {
		t.Fatalf("the sender's case must not matter: %+v", ev)
	}

	p.SubjectMode, p.Subject = "regex", `^Pagamento (con|tramite) carta$`
	if ev := evaluate([]*compiled{mustCompile(t, p)}, bankMail(), euros); ev.outcome != "" {
		t.Fatalf("subject expression: %+v", ev)
	}
}

func TestPatternWantsAnAuthenticatedSender(t *testing.T) {
	forged := bankMail()
	forged.Authenticated = false
	c := mustCompile(t, basePattern())
	if ev := evaluate([]*compiled{c}, forged, euros); ev.outcome != OutcomeUnverified {
		t.Fatalf("a forged sender: %+v, want unverified", ev)
	}
	p := basePattern()
	p.RequireAuth = false
	if ev := evaluate([]*compiled{mustCompile(t, p)}, forged, euros); ev.outcome != "" {
		t.Fatalf("with the check off: %+v", ev)
	}
}

func TestPatternDirectionFromACapture(t *testing.T) {
	p := basePattern()
	p.Body = `(?P<direction>addebito|accredito) di (?P<amount>[\d.,]+) EUR`
	p.Direction, p.InWords = DirectionCapture, "accredito, rimborso"
	c := mustCompile(t, p)
	m := bankMail()
	m.Body = "Ti segnaliamo un accredito di 1.234,56 EUR sul conto."
	if ev := evaluate([]*compiled{c}, m, euros); ev.tx.Amount != 123456 {
		t.Fatalf("money in: %+v", ev.tx)
	}
	m.Body = "Ti segnaliamo un addebito di 12,00 EUR sul conto."
	if ev := evaluate([]*compiled{c}, m, euros); ev.tx.Amount != -1200 {
		t.Fatalf("money out: %+v", ev.tx)
	}
	p.Direction = DirectionIn
	p.Body = bankExpr
	if ev := evaluate([]*compiled{mustCompile(t, p)}, bankMail(), euros); ev.tx.Amount != 643 {
		t.Fatalf("fixed in: %+v", ev.tx)
	}
}

func TestPatternSendsACardToItsAccount(t *testing.T) {
	p := basePattern()
	p.Body = `pagamento di (?P<amount>[\d.,]+) EUR con la carta (?P<card>\S+) presso (?P<memo>.+?), -`
	p.Cards = []CardAccount{{Digits: "9999", AccountID: 8}, {Digits: "5678", AccountID: 9}}
	c := mustCompile(t, p)
	if ev := evaluate([]*compiled{c}, bankMail(), euros); ev.tx.AccountID != 9 {
		t.Fatalf("card 5678 went to %d, want 9", ev.tx.AccountID)
	}
	m := bankMail()
	m.Body = strings.Replace(bankBody, "1234_*_*_5678", "1234_*_*_0000", 1)
	if ev := evaluate([]*compiled{c}, m, euros); ev.tx.AccountID != 7 {
		t.Fatalf("an unknown card went to %d, want the pattern's account 7", ev.tx.AccountID)
	}
}

func TestTheFirstPatternThatReadsTheMailWins(t *testing.T) {
	never := basePattern()
	never.Body = `bonifico di (?P<amount>[\d.,]+)`
	never.AccountID = 1
	first := basePattern()
	first.AccountID = 2
	second := basePattern()
	second.AccountID = 3
	ev := evaluate([]*compiled{mustCompile(t, never), mustCompile(t, first), mustCompile(t, second)}, bankMail(), euros)
	if ev.tx.AccountID != 2 {
		t.Fatalf("account = %d, want the first matching pattern's 2", ev.tx.AccountID)
	}
}

func TestPatternReadsTheSubjectToo(t *testing.T) {
	p := basePattern()
	p.Body = `^Pagamento di (?P<amount>[\d.,]+) EUR`
	m := bankMail()
	m.Subject = "Pagamento di 19,90 EUR"
	if ev := evaluate([]*compiled{mustCompile(t, p)}, m, euros); ev.tx.Amount != -1990 {
		t.Fatalf("amount from the subject: %+v", ev)
	}
}

func TestParseAmount(t *testing.T) {
	for _, tc := range []struct {
		in   string
		frac int
		want int64
	}{
		{"6,43", 2, 643},
		{"6.43", 2, 643},
		{"1.234,56", 2, 123456},
		{"1,234.56", 2, 123456},
		{"1.234", 2, 123400},
		{"1,234", 2, 123400},
		{"1.234.567", 2, 123456700},
		{"1.234.567,89", 2, 123456789},
		{"12", 2, 1200},
		{"0,5", 2, 50},
		{"EUR 6,43", 2, 643},
		{"-6,43", 2, 643},
		{"1.234", 0, 1234},
		{"6,437", 3, 6437},
	} {
		got, err := parseAmount(tc.in, tc.frac)
		if err != nil || got != tc.want {
			t.Errorf("parseAmount(%q, %d) = %d, %v; want %d", tc.in, tc.frac, got, err, tc.want)
		}
	}
	if _, err := parseAmount("EUR", 2); err == nil {
		t.Error("no digits must fail")
	}
}

func TestDateFromTheText(t *testing.T) {
	arrived := time.Date(2026, 10, 15, 17, 56, 0, 0, rome)
	for _, tc := range []struct {
		format, text string
		arrived      time.Time
		want         string
	}{
		{"MM.DD", "10.15", arrived, "2026-10-15"},
		{"DD/MM/YYYY", "03/02/2025", arrived, "2025-02-03"},
		{"DD-MM-YY", "3-2-25", arrived, "2025-02-03"},
		// A payment of 31 December told on 2 January belongs to last year.
		{"DD.MM", "31.12", time.Date(2027, 1, 2, 9, 0, 0, 0, rome), "2026-12-31"},
		// A few days ahead of the mail stays in its year.
		{"DD.MM", "05.01", time.Date(2027, 1, 2, 9, 0, 0, 0, rome), "2027-01-05"},
	} {
		l, err := parseLayout(tc.format)
		if err != nil {
			t.Fatal(err)
		}
		got, err := l.read(tc.text, tc.arrived)
		if err != nil || got != tc.want {
			t.Errorf("%s %q = %q, %v; want %q", tc.format, tc.text, got, err, tc.want)
		}
	}
	l, _ := parseLayout("DD.MM")
	if _, err := l.read("31.02", arrived); err == nil {
		t.Error("31 February must be refused")
	}
	if _, err := parseLayout("YYYY"); err == nil {
		t.Error("a format without day and month must be refused")
	}
}

func TestPatternWithADateGroup(t *testing.T) {
	p := basePattern()
	p.Body = `in data (?P<date>\d{2}\.\d{2}) è stato richiesto un pagamento di (?P<amount>[\d.,]+) EUR`
	p.DateFormat = "MM.DD"
	m := bankMail()
	m.Date = time.Date(2026, 10, 17, 8, 0, 0, 0, rome) // the mail came two days later
	ev := evaluate([]*compiled{mustCompile(t, p)}, m, euros)
	if ev.err != nil || ev.tx.Date != "2026-10-15" {
		t.Fatalf("date = %q, err %v", ev.tx.Date, ev.err)
	}
}

func TestInvalidPatternsAreRefusedClearly(t *testing.T) {
	for name, edit := range map[string]func(*Pattern){
		"broken expression": func(p *Pattern) { p.Body = `pagamento di (?P<amount>[\d.,]+` },
		"no amount":         func(p *Pattern) { p.Body = `presso (?P<memo>.+)` },
		"unknown group":     func(p *Pattern) { p.Body = `(?P<amount>\d+) (?P<colour>\w+)` },
		"no sender":         func(p *Pattern) { p.Sender = " " },
		"no account":        func(p *Pattern) { p.AccountID = 0 },
		"bad subject":       func(p *Pattern) { p.SubjectMode, p.Subject = "regex", `(` },
		"capture without":   func(p *Pattern) { p.Direction = DirectionCapture },
		"date without fmt":  func(p *Pattern) { p.Body = `(?P<date>\S+) (?P<amount>\d+)` },
		"card without acct": func(p *Pattern) { p.Cards = []CardAccount{{Digits: "5678"}} },
		"perl lookahead":    func(p *Pattern) { p.Body = `(?=x)(?P<amount>\d+)` },
	} {
		p := basePattern()
		edit(&p)
		_, err := compile(p)
		if !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}

func TestAuthenticationResults(t *testing.T) {
	for _, tc := range []struct {
		header, from string
		want         bool
	}{
		{"spf=pass smtp.mailfrom=banca.example; dkim=pass (signature was verified) header.d=banca.example;dmarc=pass action=none header.from=banca.example;compauth=pass", bankSender, true},
		{"dkim=pass header.d=banca.example; dmarc=fail header.from=banca.example", "avvisi@mail.banca.example", true},
		// A valid signature of another domain says nothing about this sender.
		{"dkim=pass header.d=attacker.example; dmarc=fail action=none header.from=banca.example", bankSender, false},
		{"spf=pass smtp.mailfrom=banca.example; dkim=none; dmarc=none", bankSender, false},
		{"dkim=pass header.d=example", bankSender, false},
		{"", bankSender, false},
	} {
		if got := authenticated(tc.header, tc.from); got != tc.want {
			t.Errorf("authenticated(%q, %q) = %v, want %v", tc.header, tc.from, got, tc.want)
		}
	}
}

func TestParseTrustsOnlyTheTopAuthenticationResults(t *testing.T) {
	raw := "Authentication-Results: spf=fail; dkim=none; dmarc=fail header.from=banca.example\r\n" +
		"From: <avvisi@banca.example>\r\nSubject: x\r\nMessage-ID: <a@b>\r\n" +
		// Planted by the sender, below the receiving server's own.
		"Authentication-Results: dmarc=pass header.from=banca.example\r\n" +
		"Content-Type: text/plain\r\n\r\nciao\r\n"
	m, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if m.Authenticated {
		t.Fatal("a planted Authentication-Results was trusted")
	}
}
