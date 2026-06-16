package transaction

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newTestService(t *testing.T) (*Service, *db.Queries, int64, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	ctx := context.Background()
	w, err := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W"})
	if err != nil {
		t.Fatal(err)
	}
	cur, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "€",
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w.ID, Name: "Checking", Type: "checking", CurrencyID: cur.ID, Position: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(st.Write()), q, w.ID, acc.ID
}

func iptr(v int64) *int64 { return &v }

func TestCreateWithCategoryAndTags(t *testing.T) {
	s, q, wid, acc := newTestService(t)
	ctx := context.Background()
	cat, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})

	got, err := s.Create(ctx, wid, Input{
		AccountID: acc, Date: "2026-01-15", Amount: -5000, PaymentMode: 3, Status: StatusCleared,
		CategoryID: iptr(cat.ID), Memo: "lunch", Tags: []string{"food", "cash", "food"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got.IsSplit || got.CategoryID == nil || *got.CategoryID != cat.ID {
		t.Fatalf("created = %+v", got)
	}
	if len(got.Tags) != 2 { // duplicate "food" deduped
		t.Fatalf("tags = %v, want 2 unique", got.Tags)
	}
}

func TestCreateSplit(t *testing.T) {
	s, q, wid, acc := newTestService(t)
	ctx := context.Background()
	a, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "A"})
	b, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "B"})

	got, err := s.Create(ctx, wid, Input{
		AccountID: acc, Date: "2026-01-15", Amount: -10000,
		CategoryID: iptr(a.ID), // ignored for splits
		Splits: []Split{
			{CategoryID: iptr(a.ID), Amount: -6000, Memo: "x"},
			{CategoryID: iptr(b.ID), Amount: -4000},
		},
	})
	if err != nil {
		t.Fatalf("Create split: %v", err)
	}
	if !got.IsSplit || got.CategoryID != nil || len(got.Splits) != 2 {
		t.Fatalf("split tx = %+v", got)
	}
}

func TestSplitMismatch(t *testing.T) {
	s, _, wid, acc := newTestService(t)
	_, err := s.Create(context.Background(), wid, Input{
		AccountID: acc, Date: "2026-01-15", Amount: -10000,
		Splits: []Split{{Amount: -6000}, {Amount: -3000}},
	})
	if err != ErrSplitMismatch {
		t.Fatalf("mismatch = %v, want ErrSplitMismatch", err)
	}
}

func TestValidation(t *testing.T) {
	s, _, wid, acc := newTestService(t)
	ctx := context.Background()
	base := Input{AccountID: acc, Date: "2026-01-15", Amount: -100}

	bad := base
	bad.PaymentMode = 99
	if _, err := s.Create(ctx, wid, bad); err != ErrInvalidPaymentMode {
		t.Fatalf("payment mode = %v", err)
	}
	bad = base
	bad.Status = 9
	if _, err := s.Create(ctx, wid, bad); err != ErrInvalidStatus {
		t.Fatalf("status = %v", err)
	}
	bad = base
	bad.Date = "15/01/2026"
	if _, err := s.Create(ctx, wid, bad); err != ErrInvalidDate {
		t.Fatalf("date = %v", err)
	}
	bad = base
	bad.AccountID = 9999
	if _, err := s.Create(ctx, wid, bad); err != ErrInvalidAccount {
		t.Fatalf("account = %v", err)
	}
}

func TestUpdateReplacesSplitsAndTags(t *testing.T) {
	s, q, wid, acc := newTestService(t)
	ctx := context.Background()
	a, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "A"})

	tx, _ := s.Create(ctx, wid, Input{
		AccountID: acc, Date: "2026-01-15", Amount: -100,
		Splits: []Split{{CategoryID: iptr(a.ID), Amount: -100}}, Tags: []string{"old"},
	})
	updated, err := s.Update(ctx, wid, tx.ID, Input{
		AccountID: acc, Date: "2026-02-01", Amount: -200, CategoryID: iptr(a.ID), Tags: []string{"new"},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.IsSplit || len(updated.Splits) != 0 || len(updated.Tags) != 1 || updated.Tags[0] != "new" || updated.Amount != -200 {
		t.Fatalf("updated = %+v", updated)
	}
}

func TestFindDuplicatesAndList(t *testing.T) {
	s, _, wid, acc := newTestService(t)
	ctx := context.Background()
	_, _ = s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-15", Amount: -5000})
	_, _ = s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-16", Amount: -5000})
	_, _ = s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-16", Amount: -9999})

	dups, err := s.FindDuplicates(ctx, acc, "2026-01-15", -5000, 3)
	if err != nil {
		t.Fatalf("FindDuplicates: %v", err)
	}
	if len(dups) != 2 {
		t.Fatalf("duplicates = %d, want 2", len(dups))
	}

	list, total, err := s.List(ctx, acc, 2, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 3 || len(list) != 2 {
		t.Fatalf("list total=%d len=%d, want 3 and 2", total, len(list))
	}
}
