package report

import (
	"context"
	"database/sql"
	"strconv"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func iptr(v int64) *int64 { return &v }

type fixture struct {
	s    *Service
	ts   *transaction.Service
	q    *db.Queries
	wid  int64
	acc  int64
	food int64
	groc int64
	shop int64
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
	food, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, Name: "Food"})
	groc, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, Name: "Groceries", ParentID: sql.NullInt64{Int64: food.ID, Valid: true}})
	shop, _ := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: w.ID, Name: "Shop"})
	return fixture{s: NewService(st.Write()), ts: transaction.NewService(st.Write()), q: q,
		wid: w.ID, acc: a.ID, food: food.ID, groc: groc.ID, shop: shop.ID}
}

func sumOf(groups []Group) int64 {
	var s int64
	for _, g := range groups {
		s += g.Amount
	}
	return s
}

func TestStatisticsReconcilesWithRegisterTotal(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	// Mixed: categorized, split, and a payee-only transaction.
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -3000, CategoryID: iptr(f.groc), PayeeID: iptr(f.shop)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-02-05", Amount: -5000,
		Splits: []transaction.Split{{CategoryID: iptr(f.food), Amount: -2000}, {CategoryID: iptr(f.groc), Amount: -3000}}})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-02-20", Amount: 9000, PayeeID: iptr(f.shop)})

	// Register total (initial 0) = sum of all amounts = 1000.
	_, summary, _ := f.ts.Register(ctx, f.acc)
	if summary.Future != 1000 {
		t.Fatalf("register future = %d, want 1000", summary.Future)
	}

	// Payee dimension includes the null-payee row, so it reconciles exactly.
	byPayee, err := f.s.Statistics(ctx, f.wid, Filter{}, GroupPayee)
	if err != nil {
		t.Fatalf("Statistics payee: %v", err)
	}
	if byPayee.Total != 1000 || sumOf(byPayee.Groups) != 1000 {
		t.Fatalf("payee total = %d / %d, want 1000", byPayee.Total, sumOf(byPayee.Groups))
	}

	// Category dimension over the categorized portion: -3000 + (-2000 + -3000) = -8000.
	byCat, err := f.s.Statistics(ctx, f.wid, Filter{}, GroupCategory)
	if err != nil {
		t.Fatalf("Statistics category: %v", err)
	}
	if len(byCat.Groups) != 1 || byCat.Groups[0].Amount != -8000 { // all under Food (rolled up)
		t.Fatalf("category groups = %+v", byCat.Groups)
	}

	// Subcategory keeps Food and Groceries separate.
	bySub, _ := f.s.Statistics(ctx, f.wid, Filter{}, GroupSubcategory)
	if len(bySub.Groups) != 2 {
		t.Fatalf("subcategory groups = %+v", bySub.Groups)
	}
}

func TestStatisticsByMonthAndFilter(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -1000, CategoryID: iptr(f.groc)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-02-10", Amount: -2000, CategoryID: iptr(f.groc)})

	byMonth, _ := f.s.Statistics(ctx, f.wid, Filter{}, GroupMonth)
	if len(byMonth.Groups) != 2 {
		t.Fatalf("months = %+v", byMonth.Groups)
	}

	// Filter to February only.
	feb, _ := f.s.Statistics(ctx, f.wid, Filter{From: "2026-02-01", To: "2026-02-28"}, GroupMonth)
	if len(feb.Groups) != 1 || feb.Groups[0].Key != "2026-02" || feb.Total != -2000 {
		t.Fatalf("feb = %+v", feb)
	}
}

func TestDrilldown(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	tx, _ := f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -1000, CategoryID: iptr(f.groc)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-11", Amount: -2000, CategoryID: iptr(f.food)})

	// Drill into the rolled-up Food category → both transactions (Groceries is a child).
	rows, err := f.s.Drilldown(ctx, f.wid, Filter{}, GroupCategory, "0")
	_ = rows
	_ = err
	parent, _ := f.s.Drilldown(ctx, f.wid, Filter{}, GroupCategory, itoa(f.food))
	if len(parent) != 2 {
		t.Fatalf("drilldown food = %d rows, want 2", len(parent))
	}
	sub, _ := f.s.Drilldown(ctx, f.wid, Filter{}, GroupSubcategory, itoa(f.groc))
	if len(sub) != 1 || sub[0].ID != tx.ID {
		t.Fatalf("drilldown groceries = %+v", sub)
	}
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

func TestStatisticsExcludesNoReportCategory(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	// A standalone category flagged "exclude from reports".
	hidden, _ := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wid, Name: "Hidden", NoReport: 1})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -3000, CategoryID: iptr(f.groc)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-12", Amount: -4000, CategoryID: iptr(hidden.ID)})

	// Category dimension shows only Food (rolled-up Groceries); Hidden is gone.
	byCat, err := f.s.Statistics(ctx, f.wid, Filter{}, GroupCategory)
	if err != nil {
		t.Fatalf("Statistics category: %v", err)
	}
	if byCat.Total != -3000 {
		t.Fatalf("category total = %d, want -3000 (hidden excluded)", byCat.Total)
	}
	for _, g := range byCat.Groups {
		if g.Label == "Hidden" {
			t.Fatalf("hidden category present: %+v", byCat.Groups)
		}
	}
	// A non-category dimension drops the hidden transaction from the total too.
	byMonth, _ := f.s.Statistics(ctx, f.wid, Filter{}, GroupMonth)
	if byMonth.Total != -3000 {
		t.Fatalf("month total = %d, want -3000", byMonth.Total)
	}
}

func TestStatisticsExcludesChildrenOfNoReportParent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	// Flagging the Food parent also hides its Groceries child.
	if err := f.q.UpdateCategory(ctx, db.UpdateCategoryParams{ID: f.food, Name: "Food", NoReport: 1}); err != nil {
		t.Fatalf("flag parent: %v", err)
	}
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -3000, CategoryID: iptr(f.groc)})

	byCat, _ := f.s.Statistics(ctx, f.wid, Filter{}, GroupCategory)
	if byCat.Total != 0 || len(byCat.Groups) != 0 {
		t.Fatalf("expected empty report, got %+v (total %d)", byCat.Groups, byCat.Total)
	}
}
