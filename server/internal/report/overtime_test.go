package report

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// accountWithBalance adds an account with an initial balance and returns its id.
func (f fixture) accountWithBalance(t *testing.T, name string, initial, minimum int64) int64 {
	t.Helper()
	a, err := f.q.InsertAccount(context.Background(), db.InsertAccountParams{
		WalletID: f.wid, Name: name, Type: "checking", CurrencyID: 1,
		InitialBalance: initial, MinimumBalance: minimum, Position: 9,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a.ID
}

func TestBalanceEndpointEqualsRegister(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	acc := f.accountWithBalance(t, "Main", 100000, -5000)
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-01-10", Amount: -3000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-02-15", Amount: 5000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-03-20", Amount: -1000})

	res, err := f.s.Balance(ctx, f.wid, "2026-01-01", "2026-03-31", BucketMonth, []int64{acc})
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if len(res.Buckets) != 3 || len(res.Series) != 1 {
		t.Fatalf("buckets=%v series=%d", res.Buckets, len(res.Series))
	}
	got := res.Series[0].Values
	want := []int64{97000, 102000, 101000}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("balance values = %v, want %v", got, want)
		}
	}
	if res.Series[0].MinimumBalance != -5000 {
		t.Fatalf("minimum = %d", res.Series[0].MinimumBalance)
	}

	// The endpoint must equal the register running balance.
	_, summary, _ := f.ts.Register(ctx, acc)
	if got[len(got)-1] != summary.Future {
		t.Fatalf("endpoint %d != register future %d", got[len(got)-1], summary.Future)
	}
}

func TestBalanceOpeningBalanceBeforeRange(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	acc := f.accountWithBalance(t, "Main", 100000, 0)
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-01-10", Amount: -3000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: acc, Date: "2026-02-15", Amount: 5000})

	// Range starts in February; the opening balance must include January's -3000.
	res, _ := f.s.Balance(ctx, f.wid, "2026-02-01", "2026-02-28", BucketMonth, []int64{acc})
	if len(res.Series[0].Values) != 1 || res.Series[0].Values[0] != 102000 {
		t.Fatalf("feb balance = %v, want [102000]", res.Series[0].Values)
	}
}

func TestBalanceMultiAccountOverlay(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a := f.accountWithBalance(t, "Acc1", 1000, 0)
	b := f.accountWithBalance(t, "Acc2", 2000, 0)
	res, _ := f.s.Balance(ctx, f.wid, "2026-01-01", "2026-01-31", BucketMonth, []int64{a, b})
	if len(res.Series) != 2 {
		t.Fatalf("series = %d, want 2 (overlay)", len(res.Series))
	}
}

func TestTrendByMonth(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -3000, CategoryID: iptr(f.food)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-02-10", Amount: 5000, CategoryID: iptr(f.food)})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-03-10", Amount: -1000, CategoryID: iptr(f.food)})

	res, err := f.s.Trend(ctx, f.wid, Filter{From: "2026-01-01", To: "2026-03-31"}, BucketMonth, BreakdownNone)
	if err != nil {
		t.Fatalf("Trend: %v", err)
	}
	if len(res.Buckets) != 3 || len(res.Series) != 1 {
		t.Fatalf("buckets=%v series=%d", res.Buckets, len(res.Series))
	}
	want := []int64{-3000, 5000, -1000}
	for i := range want {
		if res.Series[0].Values[i] != want[i] {
			t.Fatalf("trend = %v, want %v", res.Series[0].Values, want)
		}
	}
}

func TestTrendByAccountSeries(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	other := f.accountWithBalance(t, "Other", 0, 0)
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: f.acc, Date: "2026-01-10", Amount: -1000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: other, Date: "2026-01-11", Amount: -2000})

	res, _ := f.s.Trend(ctx, f.wid, Filter{From: "2026-01-01", To: "2026-01-31"}, BucketMonth, BreakdownAccount)
	if len(res.Series) != 2 {
		t.Fatalf("series = %d, want 2", len(res.Series))
	}
}
