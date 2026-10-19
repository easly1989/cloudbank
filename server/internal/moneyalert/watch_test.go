package moneyalert

import (
	"context"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/locale"
	"github.com/easly1989/cloudbank/server/internal/notify"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// A transaction waiting on the Review page is told to each member once it
// has waited longer than their own wait, and again only when more pass it;
// one that no longer waits is forgotten.
func TestReviewWaiting(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	t0 := time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)
	imported := func(ref string) int64 {
		t.Helper()
		txn, err := f.txns.Create(ctx, f.wallet, transaction.Input{AccountID: f.account, Date: "2026-10-01", Amount: -2500, ImportRef: ref})
		if err != nil {
			t.Fatal(err)
		}
		return txn.ID
	}
	st, _ := f.n.GetSettings(ctx, f.b)
	st.ReviewDays = 7
	if err := f.n.SetSettings(ctx, f.b, st); err != nil {
		t.Fatal(err)
	}

	first := imported("bank:1")
	f.now = t0
	f.sweep(t)
	f.now = t0.Add(3*24*time.Hour - time.Minute)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindReviewWaiting); len(got) != 0 {
		t.Fatalf("told before three days: %+v", got)
	}
	f.now = t0.Add(3 * 24 * time.Hour)
	imported("bank:2")
	f.sweep(t)
	f.sweep(t)
	got := f.bell(t, f.a, notify.KindReviewWaiting)
	if len(got) != 1 || got[0].Body != "Una transazione aspetta in Revisione da più di 3 giorni." || got[0].URL != "/review" || got[0].WalletID != f.wallet {
		t.Fatalf("after three days = %+v", got)
	}
	if got := f.bell(t, f.b, notify.KindReviewWaiting); len(got) != 0 {
		t.Fatalf("bruno waits seven days: %+v", got)
	}
	f.now = t0.Add(6 * 24 * time.Hour)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindReviewWaiting); len(got) != 2 || got[0].Body != "2 transazioni aspettano in Revisione da più di 3 giorni." {
		t.Fatalf("a second one passing = %+v", got)
	}

	// Categorised, the first no longer waits.
	cat, _ := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wallet, Name: "Spesa"})
	if _, err := f.txns.Update(ctx, f.wallet, first, transaction.Input{AccountID: f.account, Date: "2026-10-01", Amount: -2500, CategoryID: &cat.ID}); err != nil {
		t.Fatal(err)
	}
	f.now = t0.Add(10 * 24 * time.Hour)
	f.sweep(t)
	if rows, _ := f.q.ListReviewWaiting(ctx, f.wallet); len(rows) != 1 {
		t.Fatalf("still waiting: %+v", rows)
	}
	if got := f.bell(t, f.b, notify.KindReviewWaiting); len(got) != 1 || got[0].Body != "Una transazione aspetta in Revisione da più di 7 giorni." {
		t.Fatalf("bruno after seven days = %+v", got)
	}
}

// On Monday at the person's digest time, the week before: money in and out,
// the week before that, the categories that took most. Once per wallet; a
// wallet with nothing to tell sends nothing; someone without the event gets
// nothing.
func TestWeeklySummary(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	if err := f.n.SetPreference(ctx, f.a, notify.KindSummaryWeekly, notify.ChannelInApp, true); err != nil {
		t.Fatal(err)
	}
	empty, _ := f.q.CreateWallet(ctx, db.CreateWalletParams{Title: "Vuoto"})
	_ = f.q.AddWalletMember(ctx, db.AddWalletMemberParams{WalletID: empty.ID, UserID: f.a, Role: "owner"})
	spesa, _ := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wallet, Name: "Spesa"})
	casa, _ := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wallet, Name: "Casa"})
	for _, x := range []struct {
		date   string
		amount int64
		cat    *int64
	}{
		{"2026-10-06", -25000, nil}, // the week before
		{"2026-10-13", 100000, nil},
		{"2026-10-14", -30000, &spesa.ID},
		{"2026-10-15", -12000, &casa.ID},
		{"2026-10-16", -500, nil},
		{"2026-10-19", -9900, nil}, // this week
	} {
		if _, err := f.txns.Create(ctx, f.wallet, transaction.Input{AccountID: f.account, Date: x.date, Amount: x.amount, CategoryID: x.cat}); err != nil {
			t.Fatal(err)
		}
	}
	// Monday 19 October 2026, before and after 08:00 UTC.
	f.now = time.Date(2026, 10, 19, 7, 59, 0, 0, time.UTC)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindSummaryWeekly); len(got) != 0 {
		t.Fatalf("before the digest time: %+v", got)
	}
	f.now = time.Date(2026, 10, 19, 8, 5, 0, 0, time.UTC)
	f.sweep(t)
	f.sweep(t)
	got := f.bell(t, f.a, notify.KindSummaryWeekly)
	want := "Casa: entrate 1.000,00 €, uscite 425,00 €. La settimana prima: uscite 250,00 €. Di più per Spesa 300,00 €, Casa 120,00 €."
	if len(got) != 1 || got[0].Title != "La tua settimana" || got[0].Body != want || got[0].WalletID != f.wallet {
		t.Fatalf("summary = %+v", got)
	}
	if got := f.bell(t, f.b, notify.KindSummaryWeekly); len(got) != 0 {
		t.Fatalf("bruno has it off: %+v", got)
	}
	// Tuesday: no new week.
	f.now = time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	f.sweep(t)
	if got := f.bell(t, f.a, notify.KindSummaryWeekly); len(got) != 1 {
		t.Fatalf("on Tuesday = %d", len(got))
	}
}

func TestSummaryPeriods(t *testing.T) {
	p := summaryPeriods(time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)) // a Monday and the 1st
	if len(p) != 2 {
		t.Fatalf("periods = %+v", p)
	}
	if w := p[0]; w.from != "2026-05-25" || w.to != "2026-05-31" || w.prevFrom != "2026-05-18" || w.prev != "2026-05-24" {
		t.Errorf("week = %+v", w)
	}
	if m := p[1]; m.from != "2026-05-01" || m.to != "2026-05-31" || m.prevFrom != "2026-04-01" || m.prev != "2026-04-30" {
		t.Errorf("month = %+v", m)
	}
	if p := summaryPeriods(time.Date(2026, 6, 2, 8, 0, 0, 0, time.UTC)); len(p) != 0 {
		t.Errorf("a Tuesday the 2nd = %+v", p)
	}
}

// Every language CloudBank speaks has the review and summary wording.
func TestWatchLanguages(t *testing.T) {
	for _, lang := range locale.Supported {
		x, ok := watchTexts[lang]
		if !ok || x.reviewTitle == "" || x.reviewOne == "" || x.reviewMany == "" || x.day == "" || x.days == "" ||
			x.weekTitle == "" || x.monthTitle == "" || x.weekPrivate == "" || x.monthPrivate == "" || x.inOut == "" ||
			x.prevWeek == "" || x.prevMonth == "" || x.top == "" || x.billsOne == "" || x.billsMany == "" {
			t.Errorf("no complete review and summary wording for %q", lang)
		}
	}
}
