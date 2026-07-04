package report

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestCashflowForecast(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	acc := f.accountWithBalance(t, "Cashflow", 100000, -5000) // initial 1000.00, min -50.00
	today := time.Now().UTC().Truncate(24 * time.Hour)
	d := func(n int) string { return today.AddDate(0, 0, n).Format("2006-01-02") }

	// A future income of +200.00 on day 5 (already entered).
	if _, err := f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: d(5), Amount: 20000}); err != nil {
		t.Fatal(err)
	}
	// A monthly schedule of -50.00 starting day 10, no occurrence limit.
	tpl, err := f.q.InsertTemplate(ctx, db.InsertTemplateParams{
		WalletID: f.wid, Name: "Rent", AccountID: sql.NullInt64{Int64: acc, Valid: true}, Amount: -5000, PaymentMode: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: f.wid, TemplateID: tpl.ID, Unit: "month", EveryN: 1, NextDue: d(10), AutoPost: 1,
	}); err != nil {
		t.Fatal(err)
	}

	res, err := f.s.Cashflow(ctx, f.wid, acc, 30)
	if err != nil {
		t.Fatalf("Cashflow: %v", err)
	}
	if len(res.Dates) != 31 || len(res.Balances) != 31 {
		t.Fatalf("len dates=%d balances=%d, want 31", len(res.Dates), len(res.Balances))
	}
	checks := map[int]int64{
		0:  100000, // today: initial only
		4:  100000, // before the income
		5:  120000, // +200.00 income
		10: 115000, // -50.00 schedule occurrence
		30: 115000, // only the day-10 occurrence lands within 30 days
	}
	for i, want := range checks {
		if res.Balances[i] != want {
			t.Fatalf("balance[%d] = %d, want %d", i, res.Balances[i], want)
		}
	}
	if res.Minimum != -5000 {
		t.Fatalf("minimum = %d, want -5000", res.Minimum)
	}
	if res.Currency == nil || res.Currency.Code != "EUR" {
		t.Fatalf("currency = %+v", res.Currency)
	}
}
