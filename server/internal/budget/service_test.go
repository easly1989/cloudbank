package budget

import (
	"context"
	"database/sql"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func iptr(v int64) *int64 { return &v }

type fixture struct {
	s   *Service
	ts  *transaction.Service
	q   *db.Queries
	wid int64
	acc int64
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
	return fixture{s: NewService(st.Write()), ts: transaction.NewService(st.Write()), q: q, wid: w.ID, acc: a.ID}
}

func (f fixture) category(t *testing.T, name string, parent *int64, noBudget bool) int64 {
	t.Helper()
	p := sql.NullInt64{}
	if parent != nil {
		p = sql.NullInt64{Int64: *parent, Valid: true}
	}
	nb := int64(0)
	if noBudget {
		nb = 1
	}
	c, err := f.q.InsertCategory(context.Background(), db.InsertCategoryParams{WalletID: f.wid, Name: name, ParentID: p, NoBudget: nb})
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func TestSetAndListSameMode(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	food := f.category(t, "Food", nil, false)
	if err := f.s.SetCategoryBudget(ctx, f.wid, food, 0, Input{Mode: ModeSame, Same: -10000}); err != nil {
		t.Fatalf("Set: %v", err)
	}
	list, _ := f.s.List(ctx, f.wid, 0)
	if len(list) != 1 || list[0].Mode != ModeSame || list[0].Same != -10000 {
		t.Fatalf("list = %+v", list)
	}

	// Switch to monthly: replaces the same-row.
	var monthly [12]int64
	monthly[0] = -5000 // January
	monthly[1] = -6000 // February
	if err := f.s.SetCategoryBudget(ctx, f.wid, food, 0, Input{Mode: ModeMonthly, Monthly: monthly}); err != nil {
		t.Fatalf("Set monthly: %v", err)
	}
	list, _ = f.s.List(ctx, f.wid, 0)
	if list[0].Mode != ModeMonthly || list[0].Monthly[0] != -5000 || list[0].Monthly[1] != -6000 || list[0].Same != 0 {
		t.Fatalf("monthly list = %+v", list)
	}
}

func TestReportSameOverPeriodWithSplitsAndRollup(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	food := f.category(t, "Food", nil, false)
	groceries := f.category(t, "Groceries", iptr(food), false)
	excluded := f.category(t, "Hidden", nil, true) // no_budget

	// Same budget -100/month on Food.
	_ = f.s.SetCategoryBudget(ctx, f.wid, food, 0, Input{Mode: ModeSame, Same: -10000})
	_ = f.s.SetCategoryBudget(ctx, f.wid, excluded, 0, Input{Mode: ModeSame, Same: -9999})

	// Actuals in Jan-Feb: a plain Groceries txn and a split line in Food.
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -3000, CategoryID: iptr(groceries)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-02-05", Amount: -4000,
		Splits: []transaction.Split{{CategoryID: iptr(food), Amount: -4000}}})
	// Excluded-category spend must not appear.
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-20", Amount: -1000, CategoryID: iptr(excluded)})

	// Rolled up: Food gets Groceries' actual; budget = -100 * 2 months.
	rep, err := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", true)
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if len(rep.Rows) != 1 || rep.Rows[0].CategoryID != food {
		t.Fatalf("rows = %+v", rep.Rows)
	}
	if rep.Rows[0].Budget != -20000 {
		t.Fatalf("budget = %d, want -20000 (2 months × -100)", rep.Rows[0].Budget)
	}
	if rep.Rows[0].Actual != -7000 {
		t.Fatalf("actual = %d, want -7000 (Groceries -3000 + Food split -4000)", rep.Rows[0].Actual)
	}

	// Not rolled up: Food and Groceries are separate rows.
	rep2, _ := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", false)
	if len(rep2.Rows) != 2 {
		t.Fatalf("non-rollup rows = %+v", rep2.Rows)
	}
}

func TestReportPerYearBudget(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	food := f.category(t, "Food", nil, false)

	// Default for every year: -100/month. Override 2026 with -300/month.
	_ = f.s.SetCategoryBudget(ctx, f.wid, food, 0, Input{Mode: ModeSame, Same: -10000})
	_ = f.s.SetCategoryBudget(ctx, f.wid, food, 2026, Input{Mode: ModeSame, Same: -30000})

	// 2026 uses the year-specific budget: -300 × 2 months.
	rep, _ := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", false)
	if rep.Rows[0].Budget != -60000 {
		t.Fatalf("2026 budget = %d, want -60000 (year override)", rep.Rows[0].Budget)
	}
	// 2025 falls back to the every-year default: -100 × 2 months.
	rep25, _ := f.s.Report(ctx, f.wid, "2025-01-01", "2025-02-28", false)
	if rep25.Rows[0].Budget != -20000 {
		t.Fatalf("2025 budget = %d, want -20000 (every-year default)", rep25.Rows[0].Budget)
	}

	// List is year-scoped: 2026 shows -300, the default set shows -100.
	l26, _ := f.s.List(ctx, f.wid, 2026)
	if len(l26) != 1 || l26[0].Same != -30000 {
		t.Fatalf("List(2026) = %+v", l26)
	}
	l0, _ := f.s.List(ctx, f.wid, 0)
	if len(l0) != 1 || l0[0].Same != -10000 {
		t.Fatalf("List(0) = %+v", l0)
	}
}

func TestReportMonthlyBudget(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	food := f.category(t, "Food", nil, false)
	var monthly [12]int64
	monthly[0] = -10000 // Jan
	monthly[1] = -20000 // Feb
	monthly[2] = -30000 // Mar
	_ = f.s.SetCategoryBudget(ctx, f.wid, food, 0, Input{Mode: ModeMonthly, Monthly: monthly})

	rep, _ := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", false)
	if rep.Rows[0].Budget != -30000 { // Jan -100 + Feb -200
		t.Fatalf("monthly budget = %d, want -30000", rep.Rows[0].Budget)
	}
}
