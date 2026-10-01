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

func TestReportParentBudgetCoversItsSubcategories(t *testing.T) {
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

	// Food's budget covers Groceries, which has none of its own: one line.
	rep, err := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", "2026-02-28")
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
	if !rep.Rows[0].Budgeted || rep.TotalBudget != -20000 || rep.TotalActual != -7000 {
		t.Fatalf("report = %+v", rep)
	}

	// A budget of its own takes Groceries out of Food's line.
	_ = f.s.SetCategoryBudget(ctx, f.wid, groceries, 0, Input{Mode: ModeSame, Same: -2000})
	rep2, _ := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", "2026-02-28")
	if len(rep2.Rows) != 2 || rep2.Rows[0].Actual != -4000 || rep2.Rows[1].Actual != -3000 {
		t.Fatalf("rows with Groceries budgeted = %+v", rep2.Rows)
	}
}

func TestReportUnbudgetedIncomeAndComing(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	home := f.category(t, "Home", nil, false)
	rent := f.category(t, "Rent", iptr(home), false)
	bills := f.category(t, "Bills", iptr(home), false)
	health := f.category(t, "Health", nil, false)
	sal, err := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wid, Name: "Salary", IsIncome: 1})
	if err != nil {
		t.Fatal(err)
	}
	salary := sal.ID

	_ = f.s.SetCategoryBudget(ctx, f.wid, bills, 0, Input{Mode: ModeSame, Same: -10000})
	_ = f.s.SetCategoryBudget(ctx, f.wid, salary, 0, Input{Mode: ModeSame, Same: 200000})

	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-09-01", Amount: -80000, CategoryID: iptr(rent)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-09-05", Amount: -4000, CategoryID: iptr(bills)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-09-25", Amount: -8500, CategoryID: iptr(bills)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-09-12", Amount: -6479, CategoryID: iptr(health)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-09-27", Amount: 245000, CategoryID: iptr(salary)})

	rep, err := f.s.Report(ctx, f.wid, "2026-09-01", "2026-09-30", "2026-09-15")
	if err != nil {
		t.Fatal(err)
	}
	by := map[int64]ReportRow{}
	for _, r := range rep.Rows {
		by[r.CategoryID] = r
	}
	if len(rep.Rows) != 4 {
		t.Fatalf("rows = %+v", rep.Rows)
	}
	// Bills is budgeted; the September 25 one is still to come.
	if b := by[bills]; !b.Budgeted || b.Actual != -12500 || b.Coming != -8500 {
		t.Fatalf("bills = %+v", b)
	}
	// Rent and Health have no budget: listed, not budgeted, not in the totals.
	if r := by[rent]; r.Budgeted || r.Actual != -80000 {
		t.Fatalf("rent = %+v", r)
	}
	if h := by[health]; h.Budgeted || h.Actual != -6479 {
		t.Fatalf("health = %+v", h)
	}
	if s := by[salary]; !s.Budgeted || !s.IsIncome || s.Budget != 200000 || s.Actual != 245000 || s.Coming != 245000 {
		t.Fatalf("salary = %+v", s)
	}
	if _, ok := by[home]; ok {
		t.Fatal("Home has neither a budget nor spending of its own")
	}
	if rep.TotalBudget != -10000 || rep.TotalActual != -12500 || rep.TotalComing != -8500 {
		t.Fatalf("totals = %d %d %d, want the budgeted spending only", rep.TotalBudget, rep.TotalActual, rep.TotalComing)
	}
}

func TestHistory(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	food := f.category(t, "Food", nil, false)
	groceries := f.category(t, "Groceries", iptr(food), false)
	dining := f.category(t, "Dining", iptr(food), false)
	_ = f.s.SetCategoryBudget(ctx, f.wid, dining, 0, Input{Mode: ModeSame, Same: -5000})

	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-07-03", Amount: -1000, CategoryID: iptr(food)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-07-20", Amount: -2000, CategoryID: iptr(groceries)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-08-20", Amount: -3000, CategoryID: iptr(dining)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-09-10", Amount: -4000, CategoryID: iptr(groceries)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-09-20", Amount: -9000, CategoryID: iptr(groceries)}) // after today
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-06-30", Amount: -9000, CategoryID: iptr(groceries)}) // before the window

	h, err := f.s.History(ctx, f.wid, food, 3, "2026-09-15")
	if err != nil {
		t.Fatal(err)
	}
	want := []MonthAmount{{"2026-07", -3000}, {"2026-08", 0}, {"2026-09", -4000}}
	if len(h) != 3 {
		t.Fatalf("history = %+v", h)
	}
	for i := range want {
		if h[i] != want[i] {
			t.Fatalf("history = %+v, want %+v", h, want)
		}
	}
	if _, err := f.s.History(ctx, f.wid, 99999, 12, "2026-09-15"); err != ErrInvalidCategory {
		t.Fatalf("unknown category: %v", err)
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
	rep, _ := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", "2026-02-28")
	if rep.Rows[0].Budget != -60000 {
		t.Fatalf("2026 budget = %d, want -60000 (year override)", rep.Rows[0].Budget)
	}
	// 2025 falls back to the every-year default: -100 × 2 months.
	rep25, _ := f.s.Report(ctx, f.wid, "2025-01-01", "2025-02-28", "2026-02-28")
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

	rep, _ := f.s.Report(ctx, f.wid, "2026-01-01", "2026-02-28", "2026-02-28")
	if rep.Rows[0].Budget != -30000 { // Jan -100 + Feb -200
		t.Fatalf("monthly budget = %d, want -30000", rep.Rows[0].Budget)
	}
}
