package report

import (
	"context"
	"database/sql"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// The balances tab answers "how much today, how low did it get, did it go under
// its minimum" (#492) without a second request per account.
func TestBalanceTodayLowAndMinimum(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	acc := f.accountWithBalance(t, "Cash", 30000, 20000) // 300.00, minimum 200.00
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2025-12-20", Amount: -5000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-02-03", Amount: -2000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-02-12", Amount: -6000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-03-01", Amount: 9000})
	// After today: in the values, never in today's balance or the lowest point.
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-05-01", Amount: -20000})

	res, err := f.s.Balance(ctx, f.wid, "2026-01-01", "2026-06-30", BucketMonth, []int64{acc}, BalanceOptions{AsOf: "2026-04-15"})
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	s := res.Series[0]
	if s.Start != 25000 || s.Today != 26000 {
		t.Errorf("start %d, today %d; want 25000, 26000", s.Start, s.Today)
	}
	if s.Low != 17000 || s.LowDate != "2026-02-12" {
		t.Errorf("low %d on %q; want 17000 on 2026-02-12", s.Low, s.LowDate)
	}
	if s.UnderMinimumOn != "2026-02-12" {
		t.Errorf("under the minimum on %q, want 2026-02-12", s.UnderMinimumOn)
	}
	if got := s.Values[len(s.Values)-1]; got != 6000 {
		t.Errorf("June = %d, want 6000 (the May payment counts)", got)
	}
	if s.Currency == nil || s.Currency.Code != "EUR" {
		t.Errorf("currency = %+v", s.Currency)
	}
	if res.AsOf != "2026-04-15" || res.TodayTotal != 26000 || res.StartTotal != 25000 {
		t.Errorf("asOf %q, today total %d, start total %d", res.AsOf, res.TodayTotal, res.StartTotal)
	}

	// No minimum set: never "under" it, however low.
	free := f.accountWithBalance(t, "Card", 0, 0)
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: free, Date: "2026-02-01", Amount: -9000})
	res, _ = f.s.Balance(ctx, f.wid, "2026-01-01", "2026-06-30", BucketMonth, []int64{free}, BalanceOptions{AsOf: "2026-04-15"})
	if s := res.Series[0]; s.UnderMinimumOn != "" || s.Low != -9000 {
		t.Errorf("no minimum: under %q, low %d", s.UnderMinimumOn, s.Low)
	}
}

// The total is in the base currency: an account in another currency is
// converted at its rate, not added as if it were euros.
func TestBalanceTotalInBaseCurrency(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	usd, err := f.q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: f.wid, IsoCode: "USD", Name: "US dollar", Symbol: "$", SymbolPrefix: 1,
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, Rate: 0.5,
	})
	if err != nil {
		t.Fatal(err)
	}
	eur := f.accountWithBalance(t, "Euro", 10000, 0)
	dollars, err := f.q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: f.wid, Name: "Dollars", Type: "checking", CurrencyID: usd.ID, InitialBalance: 10000, Position: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	res, err := f.s.Balance(ctx, f.wid, "2026-01-01", "2026-01-31", BucketMonth, []int64{eur, dollars.ID}, BalanceOptions{AsOf: "2026-01-15"})
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if res.Total[0] != 15000 || res.TodayTotal != 15000 {
		t.Errorf("total %v, today %d; want 15000 (100 € + 100 $ at 0.5)", res.Total, res.TodayTotal)
	}
	for _, s := range res.Series {
		if s.AccountID == dollars.ID && (s.Currency == nil || s.Currency.Code != "USD" || s.Values[0] != 10000) {
			t.Errorf("dollar series = %+v, want its own currency and 10000", s)
		}
	}
}

// With the schedules, the months after today carry what is planned — the same
// projection as the dashboard's forecast — and the months before do not.
func TestBalanceScheduled(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	acc := f.accountWithBalance(t, "Main", 100000, 0)
	tpl, err := f.q.InsertTemplate(ctx, db.InsertTemplateParams{
		WalletID: f.wid, Name: "Rent", AccountID: sql.NullInt64{Int64: acc, Valid: true}, Amount: -30000, PaymentMode: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.InsertSchedule(ctx, db.InsertScheduleParams{
		WalletID: f.wid, TemplateID: tpl.ID, Unit: "month", EveryN: 1, NextDue: "2026-05-05", AutoPost: 1,
	}); err != nil {
		t.Fatal(err)
	}

	opts := BalanceOptions{AsOf: "2026-04-15", Scheduled: true}
	res, err := f.s.Balance(ctx, f.wid, "2026-03-01", "2026-06-30", BucketMonth, []int64{acc}, opts)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	want := []int64{100000, 100000, 70000, 40000} // March..June: May and June's rent
	for i, v := range want {
		if res.Series[0].Values[i] != v || res.Total[i] != v {
			t.Fatalf("values %v, total %v; want %v", res.Series[0].Values, res.Total, want)
		}
	}
	if res.Series[0].Today != 100000 {
		t.Errorf("today = %d: a schedule is not money already spent", res.Series[0].Today)
	}

	opts.Scheduled = false
	res, _ = f.s.Balance(ctx, f.wid, "2026-03-01", "2026-06-30", BucketMonth, []int64{acc}, opts)
	if res.Series[0].Values[3] != 100000 {
		t.Errorf("without schedules June = %d, want 100000", res.Series[0].Values[3])
	}
}
