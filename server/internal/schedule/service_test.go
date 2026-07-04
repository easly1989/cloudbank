package schedule

import (
	"context"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/template"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
)

type fixture struct {
	s    *Service
	tpl  *template.Service
	q    *db.Queries
	wid  int64
	accA int64
	accB int64
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	a, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1})
	b, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "B", Type: "savings", CurrencyID: cur.ID, Position: 2})
	txns := transaction.NewService(st.Write())
	transfers := transfer.NewService(st.Write())
	return fixture{
		s:    NewService(st.Write(), txns, transfers, nil),
		tpl:  template.NewService(st.Write()),
		q:    q,
		wid:  w.ID,
		accA: a.ID,
		accB: b.ID,
	}
}

func (f fixture) expenseTemplate(t *testing.T, amount int64) int64 {
	t.Helper()
	tpl, err := f.tpl.Create(context.Background(), f.wid, template.Input{
		Name: "Rent", AccountID: &f.accA, Amount: amount, PaymentMode: 4,
	})
	if err != nil {
		t.Fatalf("template: %v", err)
	}
	return tpl.ID
}

func (f fixture) count(t *testing.T, acc int64) int64 {
	t.Helper()
	n, err := f.q.CountTransactionsForAccount(context.Background(), acc)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func at(t *testing.T, s string) time.Time {
	t.Helper()
	v, _ := ParseDate(s)
	return v
}

func TestRunDueCatchUpAndIdempotent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -120000)
	_, err := f.s.Create(ctx, f.wid, Input{TemplateID: tpl, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15", AutoPost: true})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Catch up across three months.
	n, err := f.s.RunDue(ctx, at(t, "2026-03-20"))
	if err != nil {
		t.Fatalf("RunDue: %v", err)
	}
	if n != 3 || f.count(t, f.accA) != 3 {
		t.Fatalf("posted %d (account has %d), want 3", n, f.count(t, f.accA))
	}

	// Re-running with the same clock must post nothing (idempotent on restart).
	n2, err := f.s.RunDue(ctx, at(t, "2026-03-20"))
	if err != nil {
		t.Fatalf("RunDue 2: %v", err)
	}
	if n2 != 0 || f.count(t, f.accA) != 3 {
		t.Fatalf("re-run posted %d (account has %d), want 0/3", n2, f.count(t, f.accA))
	}

	// The schedule advanced past the catch-up window.
	list, _ := f.s.List(ctx, f.wid)
	if list[0].NextDue != "2026-04-15" {
		t.Fatalf("next_due = %s, want 2026-04-15", list[0].NextDue)
	}
}

func TestPostedTransactionReferencesTemplate(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -5000)
	sc, _ := f.s.Create(ctx, f.wid, Input{TemplateID: tpl, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15", AutoPost: true})
	if err := f.s.PostNow(ctx, sc.ID); err != nil {
		t.Fatalf("PostNow: %v", err)
	}
	rows, _ := f.q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: f.accA, Limit: 10, Offset: 0})
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	full, _ := f.q.GetTransaction(ctx, rows[0].ID)
	if !full.TemplateID.Valid || full.TemplateID.Int64 != tpl {
		t.Fatalf("template_id = %+v, want %d", full.TemplateID, tpl)
	}
	// A posted scheduled transaction defaults to Cleared (1), not None (0). (#243)
	if full.Status != 1 {
		t.Fatalf("posted status = %d, want Cleared (1)", full.Status)
	}
}

func TestOccurrenceLimit(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -1000)
	two := int64(2)
	sc, _ := f.s.Create(ctx, f.wid, Input{TemplateID: tpl, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15", Remaining: &two, AutoPost: true})

	n, err := f.s.RunDue(ctx, at(t, "2026-12-31"))
	if err != nil {
		t.Fatalf("RunDue: %v", err)
	}
	if n != 2 || f.count(t, f.accA) != 2 {
		t.Fatalf("posted %d (account %d), want 2", n, f.count(t, f.accA))
	}
	if _, err := f.s.Get(ctx, sc.ID); err != ErrNotFound {
		t.Fatalf("exhausted schedule should be deleted, got %v", err)
	}
}

func TestWeekendSkipDoesNotPost(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -1000)
	// 2026-03-14 is a Saturday; weekly cadence keeps landing on Saturdays.
	sc, _ := f.s.Create(ctx, f.wid, Input{
		TemplateID: tpl, Unit: UnitWeek, EveryN: 1, NextDue: "2026-03-14", WeekendMode: WeekendSkip, AutoPost: true,
	})
	n, err := f.s.RunDue(ctx, at(t, "2026-03-14"))
	if err != nil {
		t.Fatalf("RunDue: %v", err)
	}
	if n != 1 { // one occurrence processed (skipped, not inserted)
		t.Fatalf("processed %d, want 1", n)
	}
	if f.count(t, f.accA) != 0 {
		t.Fatalf("weekend-skip should not insert; account has %d", f.count(t, f.accA))
	}
	got, _ := f.s.Get(ctx, sc.ID)
	if got.NextDue != "2026-03-21" || got.LastPosted != "2026-03-14" {
		t.Fatalf("schedule = %+v", got)
	}
}

func TestWeekendAfterAdjustsPostDate(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -1000)
	sc, _ := f.s.Create(ctx, f.wid, Input{
		TemplateID: tpl, Unit: UnitMonth, EveryN: 1, NextDue: "2026-03-14", WeekendMode: WeekendAfter, AutoPost: true,
	})
	if err := f.s.PostNow(ctx, sc.ID); err != nil {
		t.Fatalf("PostNow: %v", err)
	}
	rows, _ := f.q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: f.accA, Limit: 10, Offset: 0})
	if len(rows) != 1 || rows[0].Date != "2026-03-16" {
		t.Fatalf("posted on %v, want 2026-03-16 (Monday)", rows)
	}
}

func TestSkipAdvancesWithoutPosting(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -1000)
	sc, _ := f.s.Create(ctx, f.wid, Input{TemplateID: tpl, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15", AutoPost: true})
	if err := f.s.Skip(ctx, sc.ID); err != nil {
		t.Fatalf("Skip: %v", err)
	}
	if f.count(t, f.accA) != 0 {
		t.Fatalf("skip should not post; account has %d", f.count(t, f.accA))
	}
	got, _ := f.s.Get(ctx, sc.ID)
	if got.NextDue != "2026-02-15" {
		t.Fatalf("next_due = %s, want 2026-02-15", got.NextDue)
	}
}

func TestRemindOnlyNotAutoPosted(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -1000)
	_, _ = f.s.Create(ctx, f.wid, Input{TemplateID: tpl, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15", AutoPost: false})
	n, _ := f.s.RunDue(ctx, at(t, "2026-06-01"))
	if n != 0 || f.count(t, f.accA) != 0 {
		t.Fatalf("remind-only should not auto-post; posted %d, account %d", n, f.count(t, f.accA))
	}
}

func TestScheduledTransfer(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl, _ := f.tpl.Create(ctx, f.wid, template.Input{
		Name: "Move", IsTransfer: true, AccountID: &f.accA, ToAccountID: &f.accB, Amount: -5000,
	})
	one := int64(1)
	sc, _ := f.s.Create(ctx, f.wid, Input{TemplateID: tpl.ID, Unit: UnitMonth, EveryN: 1, NextDue: "2026-01-15", Remaining: &one, AutoPost: true})

	n, err := f.s.RunDue(ctx, at(t, "2026-02-01"))
	if err != nil || n != 1 {
		t.Fatalf("RunDue: n=%d err=%v", n, err)
	}
	if f.count(t, f.accA) != 1 || f.count(t, f.accB) != 1 {
		t.Fatalf("transfer legs not posted: A=%d B=%d", f.count(t, f.accA), f.count(t, f.accB))
	}
	// Both legs reference the template.
	rowsA, _ := f.q.ListTransactionsForAccount(ctx, db.ListTransactionsForAccountParams{AccountID: f.accA, Limit: 5})
	full, _ := f.q.GetTransaction(ctx, rowsA[0].ID)
	if !full.TemplateID.Valid || full.TemplateID.Int64 != tpl.ID {
		t.Fatalf("leg template_id = %+v", full.TemplateID)
	}
	if _, err := f.s.Get(ctx, sc.ID); err != ErrNotFound {
		t.Fatalf("single-occurrence schedule should be gone, got %v", err)
	}
}

func TestRunDuePostsAheadByWalletMonths(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tpl := f.expenseTemplate(t, -1000)
	// Next occurrence is ~2 months after "today".
	if _, err := f.s.Create(ctx, f.wid, Input{
		TemplateID: tpl, Unit: UnitMonth, EveryN: 1, NextDue: "2026-03-15", AutoPost: true,
	}); err != nil {
		t.Fatalf("create schedule: %v", err)
	}
	today := at(t, "2026-01-10")

	// Default horizon (0 months, postAdvance 0): the future occurrence isn't due.
	if n, err := f.s.RunDue(ctx, today); err != nil || n != 0 {
		t.Fatalf("RunDue without horizon = %d, %v; want 0, nil", n, err)
	}

	// Set the wallet to pre-register up to 3 months ahead → the occurrence posts.
	if err := f.q.UpdateWallet(ctx, db.UpdateWalletParams{
		Title: "W", SettingsJson: `{"schedulePostMonths":3}`, ID: f.wid,
	}); err != nil {
		t.Fatalf("update wallet settings: %v", err)
	}
	if n, err := f.s.RunDue(ctx, today); err != nil || n != 1 {
		t.Fatalf("RunDue with 3-month horizon = %d, %v; want 1, nil", n, err)
	}
}
