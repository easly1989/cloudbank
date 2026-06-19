package integrity

import (
	"context"
	"database/sql"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func issueByType(issues []Issue, typ string) (Issue, bool) {
	for _, i := range issues {
		if i.Type == typ {
			return i, true
		}
	}
	return Issue{}, false
}

func TestCheckFindsSeededIssues(t *testing.T) {
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
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "bank", CurrencyID: cur.ID, Position: 1})
	income, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: w.ID, Name: "Salary", IsIncome: 1})

	// 1) split-sum mismatch: a split transaction whose splits don't add up.
	splitTxn, _ := q.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: w.ID, AccountID: acc.ID, Date: "2026-01-01", Amount: -100, IsSplit: 1,
	})
	_ = q.InsertSplit(ctx, db.InsertSplitParams{TransactionID: splitTxn.ID, Amount: -60, Position: 0})
	_ = q.InsertSplit(ctx, db.InsertSplitParams{TransactionID: splitTxn.ID, Amount: -30, Position: 1}) // sums to -90, not -100

	// 2) orphan transfer leg: a payment_mode 5 transaction with no transfers row.
	_, _ = q.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: w.ID, AccountID: acc.ID, Date: "2026-01-02", Amount: -50, PaymentMode: 5,
	})

	// 3) category-sign mismatch: income category with a negative amount.
	_, _ = q.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: w.ID, AccountID: acc.ID, Date: "2026-01-03", Amount: -200,
		CategoryID: sql.NullInt64{Int64: income.ID, Valid: true},
	})

	// 4) future-reconciled: reconciled (status 2) but dated far in the future.
	_, _ = q.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: w.ID, AccountID: acc.ID, Date: "2099-01-01", Amount: 100, Status: 2,
	})

	s := NewService(st.Write())
	issues, err := s.Check(ctx, w.ID)
	if err != nil {
		t.Fatalf("Check: %v", err)
	}

	for _, typ := range []string{TypeSplitSum, TypeOrphanTransfer, TypeCategorySign, TypeFutureReconciled} {
		iss, ok := issueByType(issues, typ)
		if !ok {
			t.Fatalf("issue %q not detected; got %+v", typ, issues)
		}
		if iss.Count != 1 {
			t.Fatalf("issue %q count = %d, want 1", typ, iss.Count)
		}
	}

	// Fixing future-reconciled downgrades it to cleared and clears the issue.
	n, err := s.Fix(ctx, w.ID, TypeFutureReconciled)
	if err != nil || n != 1 {
		t.Fatalf("Fix future_reconciled = (%d, %v), want (1, nil)", n, err)
	}
	issues2, _ := s.Check(ctx, w.ID)
	if _, ok := issueByType(issues2, TypeFutureReconciled); ok {
		t.Fatalf("future_reconciled still present after fix: %+v", issues2)
	}

	// A non-fixable type returns an error.
	if _, err := s.Fix(ctx, w.ID, TypeSplitSum); err == nil {
		t.Fatalf("expected an error fixing a non-fixable type")
	}
}

func TestCheckCleanWallet(t *testing.T) {
	st, _ := store.Open(t.TempDir())
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Clean"})

	issues, err := s(st).Check(ctx, w.ID)
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if len(issues) != 0 {
		t.Fatalf("clean wallet has issues: %+v", issues)
	}
}

func s(st *store.Store) *Service { return NewService(st.Write()) }
