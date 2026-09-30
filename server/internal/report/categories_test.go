package report

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestCategoryActivity(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	must := func(_ transaction.Transaction, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// Before the period: counts only as the latest line.
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2025-06-01", Amount: -700, CategoryID: iptr(f.food)}))
	// In the period: a plain line and a split with a line on each category.
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -3000, CategoryID: iptr(f.groc)}))
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-02-05", Amount: -5000,
		Splits: []transaction.Split{{CategoryID: iptr(f.food), Amount: -2000}, {CategoryID: iptr(f.groc), Amount: -3000}}}))
	// After the period: left out, and not the latest line either.
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-12-01", Amount: -900, CategoryID: iptr(f.groc)}))

	// An account in another currency, at half the base: 1000 of it is 500.
	usd, err := f.q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: f.wid, IsoCode: "USD", Name: "Dollar", Symbol: "$",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, Rate: 0.5,
	})
	if err != nil {
		t.Fatal(err)
	}
	dollars, err := f.q.InsertAccount(ctx, db.InsertAccountParams{WalletID: f.wid, Name: "Dollars", Type: "checking", CurrencyID: usd.ID, Position: 2})
	if err != nil {
		t.Fatal(err)
	}
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: dollars.ID, Date: "2026-03-01", Amount: -1000, CategoryID: iptr(f.groc)}))

	// A category nothing ever used.
	unused, err := f.q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: f.wid, Name: "Unused"})
	if err != nil {
		t.Fatal(err)
	}

	got, err := f.s.CategoryActivity(ctx, f.wid, "2026-01-01", "2026-06-30")
	if err != nil {
		t.Fatal(err)
	}
	if got.Currency == nil || got.Currency.Code != "EUR" {
		t.Fatalf("currency = %+v", got.Currency)
	}
	by := map[int64]CategoryActivity{}
	for _, c := range got.Categories {
		by[c.CategoryID] = c
	}
	if _, ok := by[unused.ID]; ok {
		t.Fatalf("a category never used came back: %+v", by[unused.ID])
	}
	// Groceries: -3000, the split's -3000, and the dollars' -1000 as -500.
	if g := by[f.groc]; g.Count != 3 || g.Amount != -6500 || g.LastDate != "2026-03-01" {
		t.Fatalf("groceries = %+v, want 3 lines, -6500, last 2026-03-01", g)
	}
	// Food: the split's line only; its latest line is that one, not June 2025's.
	if g := by[f.food]; g.Count != 1 || g.Amount != -2000 || g.LastDate != "2026-02-05" {
		t.Fatalf("food = %+v, want 1 line, -2000, last 2026-02-05", g)
	}

	// A period holding nothing still says when the category was last used.
	before, err := f.s.CategoryActivity(ctx, f.wid, "2025-07-01", "2025-12-31")
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Categories) != 1 || before.Categories[0].CategoryID != f.food ||
		before.Categories[0].Count != 0 || before.Categories[0].Amount != 0 || before.Categories[0].LastDate != "2025-06-01" {
		t.Fatalf("before = %+v, want only Food, empty, last 2025-06-01", before.Categories)
	}
}
