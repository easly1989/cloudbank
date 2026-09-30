package report

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestPayeeActivity(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	must := func(_ transaction.Transaction, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	in := func(date string, amount int64, cat *int64, mode int) transaction.Input {
		return transaction.Input{AccountID: f.acc, Date: date, Amount: amount, CategoryID: cat, PayeeID: iptr(f.shop), PaymentMode: mode}
	}
	// Before the period: counts only as the latest transaction.
	must(f.ts.Create(ctx, f.wid, in("2025-06-01", -700, iptr(f.food), 3)))
	// In the period: two in Groceries by card, one in Food in cash, one split,
	// one with no category.
	must(f.ts.Create(ctx, f.wid, in("2026-01-10", -3000, iptr(f.groc), 6)))
	must(f.ts.Create(ctx, f.wid, in("2026-02-10", -2000, iptr(f.groc), 6)))
	must(f.ts.Create(ctx, f.wid, in("2026-03-10", -1000, iptr(f.food), 3)))
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-04-01", Amount: -5000, PayeeID: iptr(f.shop),
		Splits: []transaction.Split{{CategoryID: iptr(f.food), Amount: -2000}, {CategoryID: iptr(f.groc), Amount: -3000}}}))
	must(f.ts.Create(ctx, f.wid, in("2026-05-01", -500, nil, 0)))
	// After the period: left out.
	must(f.ts.Create(ctx, f.wid, in("2026-12-01", -900, iptr(f.food), 3)))

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
	must(f.ts.Create(ctx, f.wid, transaction.Input{AccountID: dollars.ID, Date: "2026-06-01", Amount: -1000, PayeeID: iptr(f.shop)}))

	// A payee nothing ever used.
	idle, err := f.q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: f.wid, Name: "Idle"})
	if err != nil {
		t.Fatal(err)
	}

	got, err := f.s.PayeeActivity(ctx, f.wid, "2026-01-01", "2026-06-30")
	if err != nil {
		t.Fatal(err)
	}
	if got.Currency == nil || got.Currency.Code != "EUR" {
		t.Fatalf("currency = %+v", got.Currency)
	}
	if len(got.Payees) != 1 || got.Payees[0].PayeeID == idle.ID {
		t.Fatalf("payees = %+v, want the shop alone", got.Payees)
	}
	p := got.Payees[0]
	// -3000 -2000 -1000 -5000 -500, and the dollars' -1000 as -500.
	if p.Count != 6 || p.Amount != -12000 || p.LastDate != "2026-06-01" {
		t.Fatalf("shop = %+v, want 6 transactions, -12000, last 2026-06-01", p)
	}
	// Three plain categorised transactions, two of them in Groceries; the
	// split and the uncategorised ones do not count.
	if p.UsualCategoryID == nil || *p.UsualCategoryID != f.groc || p.UsualCategoryCount != 2 || p.CategorisedCount != 3 {
		t.Fatalf("usual category = %v (%d of %d), want Groceries, 2 of 3", p.UsualCategoryID, p.UsualCategoryCount, p.CategorisedCount)
	}
	if p.UsualPaymentMode == nil || *p.UsualPaymentMode != 6 {
		t.Fatalf("usual payment = %v, want 6", p.UsualPaymentMode)
	}

	// A period holding nothing still says when the payee was last used.
	before, err := f.s.PayeeActivity(ctx, f.wid, "2025-07-01", "2025-12-31")
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Payees) != 1 || before.Payees[0].Count != 0 || before.Payees[0].LastDate != "2025-06-01" ||
		before.Payees[0].UsualCategoryID != nil || before.Payees[0].UsualPaymentMode != nil {
		t.Fatalf("before = %+v, want the shop, empty, last 2025-06-01", before.Payees)
	}
}
