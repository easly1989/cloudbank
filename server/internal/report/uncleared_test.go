package report

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/transaction"
)

func TestUnclearedSummary(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	accA := f.accountWithBalance(t, "Uncleared-A", 0, 0)
	accB := f.accountWithBalance(t, "Uncleared-B", 0, 0)

	// Account A: two uncleared (None) transactions and one cleared (excluded).
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: accA, Date: "2026-01-10", Amount: -1000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: accA, Date: "2026-01-11", Amount: -2000})
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: accA, Date: "2026-01-12", Amount: -5000, Status: transaction.StatusCleared})
	// Account B: only reconciled → no uncleared, so it is omitted entirely.
	_, _ = f.ts.Create(ctx, f.wid, transaction.Input{AccountID: accB, Date: "2026-01-10", Amount: -500, Status: transaction.StatusReconciled})

	out, err := f.s.Uncleared(ctx, f.wid)
	if err != nil {
		t.Fatalf("Uncleared: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("accounts = %d, want 1 (only A has uncleared)", len(out))
	}
	a := out[0]
	if a.AccountID != accA || a.Count != 2 || a.Amount != -3000 {
		t.Fatalf("uncleared A = %+v, want {A, count 2, amount -3000}", a)
	}
	if a.Currency.Code != "EUR" || a.Currency.FracDigits != 2 {
		t.Fatalf("currency = %+v", a.Currency)
	}
}
