package report

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestTagActivity(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	must := func(_ transaction.Transaction, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	tagged := func(date string, amount int64, cat *int64, tags ...string) transaction.Input {
		return transaction.Input{AccountID: f.acc, Date: date, Amount: amount, CategoryID: cat, Tags: tags}
	}
	// Before the period: counts only as the latest transaction.
	must(f.ts.Create(ctx, f.wid, tagged("2025-06-01", -700, iptr(f.food), "trip")))
	// In the period: money out and in, a split, an untagged one.
	must(f.ts.Create(ctx, f.wid, tagged("2026-01-10", -3000, iptr(f.groc), "trip")))
	must(f.ts.Create(ctx, f.wid, tagged("2026-02-10", -2000, iptr(f.groc), "trip", "work")))
	must(f.ts.Create(ctx, f.wid, tagged("2026-03-10", 1500, iptr(f.food), "trip")))
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-04-01", Amount: -5000, Tags: []string{"trip"},
		Splits: []transaction.Split{{CategoryID: iptr(f.food), Amount: -2000}, {CategoryID: iptr(f.groc), Amount: -3000}}}))
	must(f.ts.Create(ctx, f.wid, tagged("2026-04-02", -900, iptr(f.food))))
	// After the period: left out.
	must(f.ts.Create(ctx, f.wid, tagged("2026-12-01", -900, iptr(f.food), "trip")))

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
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: dollars.ID, Date: "2026-05-01", Amount: -1000, Tags: []string{"trip"}}))

	// A tag on no transaction.
	if _, err := f.q.InsertTag(ctx, db.InsertTagParams{WalletID: f.wid, Name: "idle"}); err != nil {
		t.Fatal(err)
	}

	got, err := f.s.TagActivity(ctx, f.wid, "2026-01-01", "2026-06-30")
	if err != nil {
		t.Fatal(err)
	}
	if got.Currency == nil || got.Currency.Code != "EUR" {
		t.Fatalf("currency = %+v", got.Currency)
	}
	if len(got.Tags) != 2 {
		t.Fatalf("tags = %+v, want trip and work", got.Tags)
	}
	trip, work := got.Tags[0], got.Tags[1]
	// -3000 -2000 +1500 -5000, and the dollars' -1000 as -500: net -9000.
	if trip.Count != 5 || trip.Amount != -9000 || trip.LastDate != "2026-05-01" {
		t.Fatalf("trip = %+v, want 5 transactions, -9000, last 2026-05-01", trip)
	}
	// Groceries twice plain and once as a split line; Food once plain and once
	// as a split line.
	if len(trip.Categories) != 2 || trip.Categories[0] != (TagCategory{f.groc, 3}) || trip.Categories[1] != (TagCategory{f.food, 2}) {
		t.Fatalf("trip categories = %+v, want Groceries 3, Food 2", trip.Categories)
	}
	if work.Count != 1 || work.Amount != -2000 || len(work.Categories) != 1 {
		t.Fatalf("work = %+v", work)
	}

	// A period holding nothing still says when the tag was last used.
	before, err := f.s.TagActivity(ctx, f.wid, "2025-07-01", "2025-12-31")
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Tags) != 1 || before.Tags[0].Count != 0 || before.Tags[0].LastDate != "2025-06-01" || len(before.Tags[0].Categories) != 0 {
		t.Fatalf("before = %+v, want trip, empty, last 2025-06-01", before.Tags)
	}
}
