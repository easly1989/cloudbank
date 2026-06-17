package dashboard

import (
	"context"
	"database/sql"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func iptr(v int64) *int64 { return &v }

func newFixture(t *testing.T) (*Service, *transaction.Service, *db.Queries, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	w, err := q.CreateWallet(context.Background(), db.CreateWalletParams{Title: "W"})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(st.Write()), transaction.NewService(st.Write()), q, w.ID
}

func eur(t *testing.T, q *db.Queries, wid int64) int64 {
	t.Helper()
	c, err := q.InsertCurrency(context.Background(), db.InsertCurrencyParams{
		WalletID: wid, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func account(t *testing.T, q *db.Queries, wid, cur, initial int64, noSummary int64, name string) int64 {
	t.Helper()
	a, err := q.InsertAccount(context.Background(), db.InsertAccountParams{
		WalletID: wid, Name: name, Type: "checking", CurrencyID: cur,
		InitialBalance: initial, NoSummary: noSummary, Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a.ID
}

// The dashboard's per-account bank/today/future must equal the register header.
func TestDashboardMatchesRegisterHeader(t *testing.T) {
	ds, ts, q, wid := newFixture(t)
	ctx := context.Background()
	acc := account(t, q, wid, eur(t, q, wid), 100000, 0, "Main")

	_, _ = ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2000-01-01", Amount: -3000, Status: transaction.StatusReconciled})
	_, _ = ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2000-02-01", Amount: 5000, Status: transaction.StatusCleared})
	_, _ = ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2099-12-31", Amount: 1000})

	_, regSummary, err := ts.Register(ctx, acc)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	data, err := ds.Build(ctx, wid, "2000-01-01", "2099-12-31")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if len(data.Accounts) != 1 {
		t.Fatalf("accounts = %d, want 1", len(data.Accounts))
	}
	a := data.Accounts[0]
	if a.Bank != regSummary.Bank || a.Today != regSummary.Today || a.Future != regSummary.Future {
		t.Fatalf("dashboard (%d/%d/%d) != register (%d/%d/%d)",
			a.Bank, a.Today, a.Future, regSummary.Bank, regSummary.Today, regSummary.Future)
	}
}

func TestDashboardExcludesNoSummaryAndConvertsBase(t *testing.T) {
	ds, _, q, wid := newFixture(t)
	ctx := context.Background()
	base := eur(t, q, wid)
	usd, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: wid, IsoCode: "USD", Name: "US Dollar", Symbol: "$",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 0, Rate: 1.1,
	})
	if err != nil {
		t.Fatal(err)
	}
	account(t, q, wid, base, 10000, 0, "EUR-A")    // 100.00 EUR
	account(t, q, wid, usd.ID, 5000, 0, "USD-B")   // 50.00 USD → 55.00 EUR
	account(t, q, wid, base, 99999, 1, "Excluded") // excluded (no_summary)

	data, err := ds.Build(ctx, wid, "2026-01-01", "2026-01-31")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if data.BaseCurrency == nil || data.BaseCurrency.Code != "EUR" {
		t.Fatalf("base currency = %+v", data.BaseCurrency)
	}
	if data.Totals.Future != 15500 {
		t.Fatalf("totals.future = %d, want 15500 (100 EUR + 55 EUR; no-summary excluded)", data.Totals.Future)
	}
}

func TestDashboardTopCategories(t *testing.T) {
	ds, ts, q, wid := newFixture(t)
	ctx := context.Background()
	acc := account(t, q, wid, eur(t, q, wid), 0, 0, "Main")

	food, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	groceries, _ := q.InsertCategory(ctx, db.InsertCategoryParams{
		WalletID: wid, Name: "Groceries", ParentID: sql.NullInt64{Int64: food.ID, Valid: true},
	})
	car, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Car"})

	_, _ = ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2026-03-10", Amount: -3000, CategoryID: iptr(groceries.ID)})
	_, _ = ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2026-03-12", Amount: -2000, CategoryID: iptr(car.ID)})
	_, _ = ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2026-03-15", Amount: 9000, CategoryID: iptr(food.ID)}) // income: excluded
	_, _ = ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2026-09-01", Amount: -8000, CategoryID: iptr(car.ID)}) // out of range

	data, err := ds.Build(ctx, wid, "2026-03-01", "2026-03-31")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if len(data.TopCategories) != 2 {
		t.Fatalf("top categories = %+v, want 2", data.TopCategories)
	}
	// Groceries rolls up to Food (3000), then Car (2000), sorted desc.
	if data.TopCategories[0].CategoryID != food.ID || data.TopCategories[0].Amount != 3000 {
		t.Fatalf("slice 0 = %+v, want Food 3000", data.TopCategories[0])
	}
	if data.TopCategories[1].CategoryID != car.ID || data.TopCategories[1].Amount != 2000 {
		t.Fatalf("slice 1 = %+v, want Car 2000", data.TopCategories[1])
	}
}
