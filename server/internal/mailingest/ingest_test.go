package mailingest

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/emersion/go-imap/v2"

	"github.com/easly1989/cloudbank/server/internal/account"
	"github.com/easly1989/cloudbank/server/internal/assignment"
	"github.com/easly1989/cloudbank/server/internal/importio"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// The mails below are invented, shaped like a card-payment notice. None is
// a real bank's mail.

// ledger gives the fixture's wallet a euro account, a second one for a card,
// and the import pipeline.
func (f *fixture) ledger(t *testing.T) (main, card int64) {
	t.Helper()
	ctx := context.Background()
	cur, err := f.q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: f.wallet, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := f.q.InsertAccount(ctx, db.InsertAccountParams{WalletID: f.wallet, Name: "Conto", Type: "bank", CurrencyID: cur.ID, Position: 1})
	c, _ := f.q.InsertAccount(ctx, db.InsertAccountParams{WalletID: f.wallet, Name: "Carta", Type: "creditcard", CurrencyID: cur.ID, Position: 2})
	w := f.st.Write()
	f.svc.SetImporter(importio.NewService(w, transaction.NewService(w), assignment.NewService(w), account.NewService(w)))
	return a.ID, c.ID
}

// sendMail drops a card-payment notice in the folder. auth adds the receiving
// server's verdict that the sender's domain signed it.
func sendMail(t *testing.T, f *fixture, id, amount, shop, card string, auth bool) {
	t.Helper()
	var h strings.Builder
	if auth {
		h.WriteString("Authentication-Results: mx.example.com; dkim=pass header.d=banca.example; dmarc=pass header.from=banca.example\r\n")
	}
	fmt.Fprintf(&h, "From: Banca Demo <avvisi@banca.example>\r\nTo: %s\r\n", testUser)
	fmt.Fprintf(&h, "Subject: Pagamento con carta\r\nMessage-ID: <%s@banca.example>\r\n", id)
	h.WriteString("Date: Thu, 15 Oct 2026 23:56:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n")
	fmt.Fprintf(&h, "Gentile cliente, hai pagato %s EUR presso %s con la carta *%s.\r\n", amount, shop, card)
	if _, err := f.user.Append("INBOX", bytes.NewReader([]byte(h.String())), &imap.AppendOptions{}); err != nil {
		t.Fatal(err)
	}
}

func cardPattern(account int64) Pattern {
	return Pattern{
		Name: "Carta", Sender: "Avvisi@Banca.example", SubjectMode: "contains", Subject: "pagamento",
		Body:      `hai pagato (?P<amount>[\d.,]+) EUR presso (?P<memo>.+?) con la carta \*(?P<card>\d+)`,
		AccountID: account, Direction: DirectionOut, PaymentMode: 6, ApplyRules: true, RequireAuth: true,
	}
}

func (f *fixture) transactions(t *testing.T, account int64) []db.ListTransactionsForAccountRow {
	t.Helper()
	rows, err := f.q.ListTransactionsForAccount(context.Background(), db.ListTransactionsForAccountParams{AccountID: account, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestAMailAPatternReadsBecomesAClearedTransaction(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, cardAcc := f.ledger(t)
	mb := f.connect(t)
	p := cardPattern(acc)
	p.Cards = []CardAccount{{Digits: "9876", AccountID: cardAcc}}
	saved, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, p)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Sender != "avvisi@banca.example" || saved.Position != 0 {
		t.Fatalf("saved = %+v", saved)
	}

	sendMail(t, f, "a1", "1.234,56", "Supermercato Demo", "1234", true)
	sendMail(t, f, "a2", "6,43", "Bar Demo", "9876", true)
	res, err := f.svc.Check(ctx, f.wallet, mb.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res != (CheckResult{New: 2, Created: 2}) {
		t.Fatalf("check = %+v", res)
	}

	got := f.transactions(t, acc)
	if len(got) != 1 {
		t.Fatalf("account has %d transactions", len(got))
	}
	tx := got[0]
	// Late in the evening where the mail was written: still the 15th there.
	if tx.Amount != -123456 || tx.Memo != "Supermercato Demo" || tx.Date != "2026-10-15" ||
		tx.Status != transaction.StatusCleared || tx.PaymentMode != 6 ||
		!strings.HasPrefix(tx.ImportRef, importio.MailRefPrefix) {
		t.Fatalf("transaction = %+v", tx)
	}
	// The other card's payment went to its own account.
	if card := f.transactions(t, cardAcc); len(card) != 1 || card[0].Amount != -643 {
		t.Fatalf("card account = %+v", card)
	}

	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	m := msgs[1] // newest first: a1 is the older
	if m.Outcome != OutcomeCreated || m.TransactionID == nil || *m.TransactionID != tx.ID ||
		m.AccountID == nil || *m.AccountID != acc || m.PatternID == nil || *m.PatternID != saved.ID || !m.Authenticated ||
		m.Amount == nil || *m.Amount != -123456 || m.Memo == nil || *m.Memo != "Supermercato Demo" ||
		m.Payee != nil { // the pattern reads no payee
		t.Fatalf("history = %+v", m)
	}
	d, err := f.svc.Message(ctx, f.wallet, mb.ID, m.ID)
	if err != nil || !strings.Contains(d.Body, "Supermercato Demo") || *d.AccountID != acc {
		t.Fatalf("detail = %+v, %v", d, err)
	}
	if _, err := f.svc.Message(ctx, f.other, mb.ID, m.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("detail from another wallet: %v", err)
	}
}

func TestTheSameMailMakesOneTransaction(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	mb := f.connect(t)
	saved, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, cardPattern(acc))
	if err != nil {
		t.Fatal(err)
	}
	sendMail(t, f, "same", "6,43", "Bar Demo", "1234", true)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	// The same mail again: moved back into the folder, or sent twice.
	sendMail(t, f, "same", "6,43", "Bar Demo", "1234", true)
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.New != 0 {
		t.Fatalf("the same mail was read again: %+v", res)
	}
	// And read once more by a pattern, as if no pattern had read it: the
	// account already has its transaction.
	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	_ = f.q.SetMailMessageOutcome(ctx, db.SetMailMessageOutcomeParams{Outcome: OutcomeUnrecognized, ID: msgs[0].ID})
	res, err := f.svc.ApplyPattern(ctx, f.wallet, mb.ID, saved.ID)
	if err != nil || res != (ApplyResult{Duplicate: 1}) {
		t.Fatalf("apply = %+v, %v", res, err)
	}
	if got := f.transactions(t, acc); len(got) != 1 {
		t.Fatalf("account has %d transactions", len(got))
	}
	msgs, _ = f.svc.Messages(ctx, f.wallet, mb.ID)
	if msgs[0].Outcome != OutcomeDuplicate || msgs[0].TransactionID == nil {
		t.Fatalf("history = %+v", msgs[0])
	}
	// Two payments of the same amount on the same day are two.
	sendMail(t, f, "other", "6,43", "Bar Demo", "1234", true)
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.Created != 1 {
		t.Fatalf("a second coffee was taken for a duplicate: %+v", res)
	}
}

func TestAnUnauthenticatedMailWritesNothing(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	var alerts []string
	f.svc.SetNotify(func(_ context.Context, _ int64, _, _, _, body, _ string) error {
		alerts = append(alerts, body)
		return nil
	})
	mb := f.connect(t)
	saved, _ := f.svc.CreatePattern(ctx, f.wallet, mb.ID, cardPattern(acc))

	sendMail(t, f, "forged", "500,00", "Truffa Demo", "1234", false)
	res, err := f.svc.Check(ctx, f.wallet, mb.ID)
	if err != nil || res != (CheckResult{New: 1, Unrecognized: 1}) {
		t.Fatalf("check = %+v, %v", res, err)
	}
	if got := f.transactions(t, acc); len(got) != 0 {
		t.Fatalf("a forged mail wrote %+v", got)
	}
	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	if msgs[0].Outcome != OutcomeUnverified || msgs[0].Authenticated {
		t.Fatalf("history = %+v", msgs[0])
	}
	if len(alerts) != 1 {
		t.Fatalf("alerts = %v", alerts)
	}

	// Turned off under Advanced, the pattern reads it after all.
	p := cardPattern(acc)
	p.RequireAuth = false
	if _, err := f.svc.UpdatePattern(ctx, f.wallet, mb.ID, saved.ID, p); err != nil {
		t.Fatal(err)
	}
	if res, _ := f.svc.ApplyPattern(ctx, f.wallet, mb.ID, saved.ID); res.Created != 1 {
		t.Fatalf("apply = %+v", res)
	}
}

func TestAPatternIsCheckedBeforeItIsSaved(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	mb := f.connect(t)

	bad := cardPattern(acc)
	bad.Body = `hai pagato (?P<amount>[\d.,+) EUR`
	_, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, bad)
	if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "the expression is not valid: missing closing ]") {
		t.Fatalf("invalid expression: %v", err)
	}
	if _, err := f.svc.TestPattern(ctx, f.wallet, mb.ID, bad); !errors.Is(err, ErrInvalid) {
		t.Fatalf("testing an invalid expression: %v", err)
	}

	// An account of another wallet is refused, for the pattern and a card.
	otherCur, _ := f.q.InsertCurrency(ctx, db.InsertCurrencyParams{WalletID: f.other, IsoCode: "EUR", Name: "Euro", Symbol: "€", FracDigits: 2, IsBase: 1, Rate: 1})
	foreign, _ := f.q.InsertAccount(ctx, db.InsertAccountParams{WalletID: f.other, Name: "Altro", Type: "bank", CurrencyID: otherCur.ID})
	if _, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, cardPattern(foreign.ID)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("another wallet's account: %v", err)
	}
	p := cardPattern(acc)
	p.Cards = []CardAccount{{Digits: "1234", AccountID: foreign.ID}}
	if _, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, p); !errors.Is(err, ErrInvalid) {
		t.Fatalf("another wallet's card account: %v", err)
	}
	// And so is another wallet's mailbox.
	if _, err := f.svc.CreatePattern(ctx, f.other, mb.ID, cardPattern(acc)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another wallet's mailbox: %v", err)
	}
	if list, _ := f.svc.Patterns(ctx, f.wallet, mb.ID); len(list) != 0 {
		t.Fatalf("saved %+v", list)
	}
}

func TestTryAPatternThenApplyItToTheWaitingMails(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	mb := f.connect(t)
	// Mails that arrived before any pattern.
	sendMail(t, f, "w1", "6,43", "Bar Demo", "1234", true)
	sendMail(t, f, "w2", "12,00", "Edicola Demo", "1234", true)
	appendMail(t, f.user, "INBOX", 3) // the same sender, a different text
	if res, _ := f.svc.Check(ctx, f.wallet, mb.ID); res.Unrecognized != 3 {
		t.Fatalf("check = %+v", res)
	}

	tried, err := f.svc.TestPattern(ctx, f.wallet, mb.ID, cardPattern(acc))
	if err != nil {
		t.Fatal(err)
	}
	if tried.Matched != 2 || tried.Total != 3 || tried.Retry != 2 {
		t.Fatalf("test = %+v", tried)
	}
	var edicola *Extracted
	for _, m := range tried.Mails {
		if m.Transaction != nil && m.Transaction.Memo == "Edicola Demo" {
			edicola = m.Transaction
		}
	}
	if edicola == nil || edicola.Amount != -1200 || edicola.Date != "2026-10-15" || edicola.AccountID != acc {
		t.Fatalf("preview = %+v", tried.Mails)
	}
	if got := f.transactions(t, acc); len(got) != 0 {
		t.Fatal("trying a pattern wrote a transaction")
	}

	saved, _ := f.svc.CreatePattern(ctx, f.wallet, mb.ID, cardPattern(acc))
	res, err := f.svc.ApplyPattern(ctx, f.wallet, mb.ID, saved.ID)
	if err != nil || res != (ApplyResult{Created: 2}) {
		t.Fatalf("apply = %+v, %v", res, err)
	}
	if got := f.transactions(t, acc); len(got) != 2 {
		t.Fatalf("account has %d transactions", len(got))
	}
	if again, _ := f.svc.TestPattern(ctx, f.wallet, mb.ID, cardPattern(acc)); again.Retry != 0 {
		t.Fatalf("after applying: %+v", again)
	}
}

// A mail a pattern read but could not write is read again once the pattern
// is corrected.
func TestAFailedMailIsReadAgainAfterTheFix(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, _ := f.ledger(t)
	mb := f.connect(t)
	p := cardPattern(acc)
	p.Body = `hai pagato (?P<amount>[\d.,]+) EUR presso (?P<date>.+?) con`
	p.DateFormat = "DD/MM"
	saved, err := f.svc.CreatePattern(ctx, f.wallet, mb.ID, p)
	if err != nil {
		t.Fatal(err)
	}
	sendMail(t, f, "f1", "6,43", "Bar Demo", "1234", true)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	if msgs[0].Outcome != OutcomeFailed || !strings.Contains(msgs[0].Detail, "does not fit the format") {
		t.Fatalf("history = %+v", msgs[0])
	}
	if _, err := f.svc.UpdatePattern(ctx, f.wallet, mb.ID, saved.ID, cardPattern(acc)); err != nil {
		t.Fatal(err)
	}
	if res, _ := f.svc.ApplyPattern(ctx, f.wallet, mb.ID, saved.ID); res.Created != 1 {
		t.Fatalf("apply = %+v", res)
	}
}

func TestTheFirstPatternInTheListWins(t *testing.T) {
	withKey(t)
	f := newFixture(t)
	ctx := context.Background()
	acc, cardAcc := f.ledger(t)
	mb := f.connect(t)
	first, _ := f.svc.CreatePattern(ctx, f.wallet, mb.ID, cardPattern(acc))
	second, _ := f.svc.CreatePattern(ctx, f.wallet, mb.ID, cardPattern(cardAcc))
	if second.Position != 1 {
		t.Fatalf("second position = %d", second.Position)
	}
	sendMail(t, f, "o1", "6,43", "Bar Demo", "1234", true)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	if len(f.transactions(t, acc)) != 1 {
		t.Fatal("the first pattern did not win")
	}

	list, err := f.svc.ReorderPatterns(ctx, f.wallet, mb.ID, []int64{second.ID, first.ID})
	if err != nil || list[0].ID != second.ID {
		t.Fatalf("reorder = %+v, %v", list, err)
	}
	sendMail(t, f, "o2", "6,43", "Bar Demo", "1234", true)
	_, _ = f.svc.Check(ctx, f.wallet, mb.ID)
	if len(f.transactions(t, cardAcc)) != 1 {
		t.Fatal("after reordering, the new first pattern did not win")
	}
	if _, err := f.svc.ReorderPatterns(ctx, f.wallet, mb.ID, []int64{second.ID}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("an order missing a pattern: %v", err)
	}
	if err := f.svc.DeletePattern(ctx, f.wallet, mb.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.DeletePattern(ctx, f.other, mb.ID, second.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete from another wallet: %v", err)
	}
}
