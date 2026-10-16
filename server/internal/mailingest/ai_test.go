package mailingest

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/ai"
)

// fakeAI reads a card notice the way a model would: the shop after "presso"
// and the amount after "pagato". It answers nothing for a bookshop, as a model
// that does not take it for a payment, and fails when told to.
type fakeAI struct {
	configured bool
	fail       error
	calls      []string // the subjects and bodies it was sent
}

var (
	reFakeShop   = regexp.MustCompile(`presso (.+?) con`)
	reFakeAmount = regexp.MustCompile(`pagato ([\d.,]+) EUR`)
)

func (a *fakeAI) Configured(context.Context, int64) bool { return a.configured }

func (a *fakeAI) ReadBankMail(_ context.Context, _ int64, subject, body, _ string) (*ai.MailReading, error) {
	if !a.configured {
		return nil, ai.ErrNotConfigured
	}
	a.calls = append(a.calls, subject+"\n"+body)
	if a.fail != nil {
		return nil, a.fail
	}
	if strings.Contains(body, "Libreria") {
		return nil, nil
	}
	shop, amount := reFakeShop.FindStringSubmatch(body), reFakeAmount.FindStringSubmatch(body)
	if shop == nil || amount == nil {
		return nil, nil
	}
	return &ai.MailReading{Amount: amount[1], Direction: "out", Text: "AI " + shop[1]}, nil
}

// aiFixture is a mailbox with a pattern for the bar and the bookshop, and an
// AI that reads what the folder gets.
func aiFixture(t *testing.T) (*fixture, *fakeAI, Mailbox, int64) {
	t.Helper()
	withKey(t)
	f := newFixture(t)
	acc, _ := f.ledger(t)
	fa := &fakeAI{configured: true}
	f.svc.SetAI(fa)
	mb := f.connect(t)
	p := cardPattern(acc)
	p.Body = `hai pagato (?P<amount>[\d.,]+) EUR presso (?P<memo>Bar Demo|Libreria Demo) con`
	if _, err := f.svc.CreatePattern(context.Background(), f.wallet, mb.ID, p); err != nil {
		t.Fatal(err)
	}
	return f, fa, mb, acc
}

func (f *fixture) setAI(t *testing.T, mb Mailbox, acc int64, mode string) Mailbox {
	t.Helper()
	got, err := f.svc.UpdateAI(context.Background(), f.wallet, mb.ID, MailboxAI{
		Mode: mode, AccountID: &acc, Field: AIFieldMemo, Senders: []string{"banca.example"},
	})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// memos are the account's transactions as memo → whether the AI read it.
func (f *fixture) memos(t *testing.T, mb Mailbox, acc int64) map[string]bool {
	t.Helper()
	msgs, err := f.svc.Messages(context.Background(), f.wallet, mb.ID)
	if err != nil {
		t.Fatal(err)
	}
	byTx := map[int64]bool{}
	for _, m := range msgs {
		if m.TransactionID != nil {
			byTx[*m.TransactionID] = m.ByAI
		}
	}
	out := map[string]bool{}
	for _, tx := range f.transactions(t, acc) {
		out[tx.Memo] = byTx[tx.ID]
	}
	return out
}

func TestTheFourOrdersOfPatternsAndAI(t *testing.T) {
	for _, tc := range []struct {
		mode  string
		memos map[string]bool
		calls int
	}{
		{AIModePatterns, map[string]bool{"Bar Demo": false, "Libreria Demo": false}, 0},
		// The AI only gets what no pattern read.
		{AIModePatternsAI, map[string]bool{"Bar Demo": false, "Libreria Demo": false, "AI Edicola Demo": true}, 1},
		// The AI first; a pattern only for what it did not take for a payment.
		{AIModeAIPatterns, map[string]bool{"AI Bar Demo": true, "AI Edicola Demo": true, "Libreria Demo": false}, 3},
		{AIModeAI, map[string]bool{"AI Bar Demo": true, "AI Edicola Demo": true}, 3},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			f, fa, mb, acc := aiFixture(t)
			f.setAI(t, mb, acc, tc.mode)
			sendMail(t, f, "m1", "1,20", "Bar Demo", "1234", true)
			sendMail(t, f, "m2", "2,50", "Edicola Demo", "1234", true)
			sendMail(t, f, "m3", "18,00", "Libreria Demo", "1234", true)
			if _, err := f.svc.Check(context.Background(), f.wallet, mb.ID); err != nil {
				t.Fatal(err)
			}
			got := f.memos(t, mb, acc)
			if len(got) != len(tc.memos) {
				t.Fatalf("transactions %v, want %v", got, tc.memos)
			}
			for memo, byAI := range tc.memos {
				if v, ok := got[memo]; !ok || v != byAI {
					t.Fatalf("transactions %v, want %v", got, tc.memos)
				}
			}
			if len(fa.calls) != tc.calls {
				t.Fatalf("the AI was asked %d times, want %d", len(fa.calls), tc.calls)
			}
			// What the AI did not read stays unrecognised, never failed.
			msgs, _ := f.svc.Messages(context.Background(), f.wallet, mb.ID)
			for _, m := range msgs {
				if m.Outcome != OutcomeCreated && m.Outcome != OutcomeUnrecognized {
					t.Fatalf("mail %q: %s %s", m.Subject, m.Outcome, m.Detail)
				}
			}
		})
	}
}

func TestAITransactionsGoToTheChosenAccountAndField(t *testing.T) {
	f, _, mb, acc := aiFixture(t)
	ctx := context.Background()
	if _, err := f.svc.UpdateAI(ctx, f.wallet, mb.ID, MailboxAI{
		Mode: AIModeAI, AccountID: &acc, Field: AIFieldPayee, Senders: []string{"avvisi@banca.example"},
	}); err != nil {
		t.Fatal(err)
	}
	sendMail(t, f, "m1", "1.234,56", "Edicola Demo", "1234", true)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	txs := f.transactions(t, acc)
	if len(txs) != 1 || txs[0].Amount != -123456 || txs[0].Date != "2026-10-15" || txs[0].Memo != "" {
		t.Fatalf("transactions = %+v", txs)
	}
	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	if msgs[0].Payee == nil || *msgs[0].Payee != "AI Edicola Demo" || !msgs[0].ByAI {
		t.Fatalf("mail = %+v", msgs[0])
	}
}

// Only the listed senders' mails are sent to the AI, and never one whose
// sender the receiving server did not vouch for.
func TestTheAIGetsOnlyAuthenticatedMailsOfTheListedSenders(t *testing.T) {
	f, fa, mb, acc := aiFixture(t)
	ctx := context.Background()
	if _, err := f.svc.UpdateAI(ctx, f.wallet, mb.ID, MailboxAI{
		Mode: AIModeAI, AccountID: &acc, Field: AIFieldMemo, Senders: []string{"altrabanca.example"},
	}); err != nil {
		t.Fatal(err)
	}
	sendMail(t, f, "m1", "2,50", "Edicola Demo", "1234", true)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	if len(fa.calls) != 0 {
		t.Fatal("a mail from an unlisted sender reached the AI")
	}

	f.setAI(t, mb, acc, AIModeAI)
	sendMail(t, f, "m2", "2,50", "Edicola Demo", "1234", false)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	if len(fa.calls) != 0 {
		t.Fatal("an unauthenticated mail reached the AI")
	}
	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	if msgs[0].Outcome != OutcomeUnverified || msgs[1].Outcome != OutcomeUnrecognized {
		t.Fatalf("outcomes = %s, %s", msgs[0].Outcome, msgs[1].Outcome)
	}
}

func TestAIFailingOrGoneLeavesTheMailUnwritten(t *testing.T) {
	f, fa, mb, acc := aiFixture(t)
	ctx := context.Background()
	f.setAI(t, mb, acc, AIModeAI)

	fa.fail = errors.New("ai: provider returned 503")
	sendMail(t, f, "m1", "2,50", "Edicola Demo", "1234", true)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	msgs, _ := f.svc.Messages(ctx, f.wallet, mb.ID)
	if msgs[0].Outcome != OutcomeFailed || !strings.Contains(msgs[0].Detail, "503") || !msgs[0].ByAI {
		t.Fatalf("mail = %+v", msgs[0])
	}

	// The AI was switched off since: the mail is just not recognised.
	fa.fail, fa.configured = nil, false
	sendMail(t, f, "m2", "2,50", "Edicola Demo", "1234", true)
	if _, err := f.svc.Check(ctx, f.wallet, mb.ID); err != nil {
		t.Fatal(err)
	}
	msgs, _ = f.svc.Messages(ctx, f.wallet, mb.ID)
	if msgs[0].Outcome != OutcomeUnrecognized {
		t.Fatalf("mail = %+v", msgs[0])
	}
	list, _ := f.svc.ListMailboxes(ctx, f.wallet)
	if list[0].AIReady {
		t.Fatal("aiReady without AI configured")
	}
}

func TestAIModesAreChecked(t *testing.T) {
	f, fa, mb, acc := aiFixture(t)
	ctx := context.Background()
	other := int64(9999)
	for name, in := range map[string]MailboxAI{
		"unknown mode":    {Mode: "magic", AccountID: &acc, Field: AIFieldMemo, Senders: []string{"banca.example"}},
		"no account":      {Mode: AIModeAI, Field: AIFieldMemo, Senders: []string{"banca.example"}},
		"foreign account": {Mode: AIModeAI, AccountID: &other, Field: AIFieldMemo, Senders: []string{"banca.example"}},
		"bad field":       {Mode: AIModeAI, AccountID: &acc, Field: "category", Senders: []string{"banca.example"}},
		"no senders":      {Mode: AIModeAI, AccountID: &acc, Field: AIFieldMemo, Senders: []string{" "}},
		"bad sender":      {Mode: AIModeAI, AccountID: &acc, Field: AIFieldMemo, Senders: []string{"not a sender"}},
	} {
		if _, err := f.svc.UpdateAI(ctx, f.wallet, mb.ID, in); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}

	got := f.setAI(t, mb, acc, AIModePatternsAI)
	if got.AI.Mode != AIModePatternsAI || *got.AI.AccountID != acc || got.AI.Senders[0] != "banca.example" || !got.AIReady {
		t.Fatalf("mailbox = %+v", got)
	}
	// Without AI configured, only "patterns" can be chosen.
	fa.configured = false
	if _, err := f.svc.UpdateAI(ctx, f.wallet, mb.ID, MailboxAI{
		Mode: AIModeAI, AccountID: &acc, Field: AIFieldMemo, Senders: []string{"banca.example"},
	}); !errors.Is(err, ErrAINotConfigured) {
		t.Fatalf("err = %v, want ErrAINotConfigured", err)
	}
	if _, err := f.svc.UpdateAI(ctx, f.wallet, mb.ID, MailboxAI{Mode: AIModePatterns}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateAI(ctx, f.other, mb.ID, MailboxAI{Mode: AIModePatterns}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("from another wallet: %v", err)
	}
}
