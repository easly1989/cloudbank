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

func TestRegisterRunningBalanceOrdering(t *testing.T) {
	s, _, wid, acc := newTestService(t)
	ctx := context.Background()
	// Inserted out of date order; the register must order by (date, id).
	tx1, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-10", Amount: 10000})
	_, _ = s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-05", Amount: -3000})
	tx3, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-10", Amount: 2000})

	rows, summary, err := s.Register(ctx, acc)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(rows))
	}
	// Chronological: 01-05 (-3000), 01-10/tx1 (+10000), 01-10/tx3 (+2000).
	want := []struct {
		date string
		bal  int64
	}{{"2026-01-05", -3000}, {"2026-01-10", 7000}, {"2026-01-10", 9000}}
	for i, w := range want {
		if rows[i].Date != w.date || rows[i].RunningBalance != w.bal {
			t.Fatalf("row %d = (%s, %d), want (%s, %d)", i, rows[i].Date, rows[i].RunningBalance, w.date, w.bal)
		}
	}
	// Same-date tie broken by id (tx1 before tx3).
	if rows[1].ID != tx1.ID || rows[2].ID != tx3.ID {
		t.Fatalf("same-date tie not ordered by id: %d then %d", rows[1].ID, rows[2].ID)
	}
	if summary.Future != 9000 {
		t.Fatalf("future = %d, want 9000", summary.Future)
	}
}

func TestRegisterSummaryAndInitialBalance(t *testing.T) {
	s, q, wid, _ := newTestService(t)
	ctx := context.Background()
	cur, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: wid, IsoCode: "USD", Name: "USD", Symbol: "$",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 0, Rate: 1,
	})
	acc, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: wid, Name: "Savings", Type: "savings", CurrencyID: cur.ID,
		InitialBalance: 100000, Position: 2,
	})
	// A past, reconciled inflow and a far-future inflow.
	past, _ := s.Create(ctx, wid, Input{AccountID: acc.ID, Date: "2000-01-01", Amount: 5000, Status: StatusReconciled})
	_, _ = s.Create(ctx, wid, Input{AccountID: acc.ID, Date: "2099-12-31", Amount: 1000})

	_, summary, err := s.Register(ctx, acc.ID)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if summary.Future != 106000 {
		t.Fatalf("future = %d, want 106000 (initial + 5000 + 1000)", summary.Future)
	}
	if summary.Today != 105000 {
		t.Fatalf("today = %d, want 105000 (excludes far-future row)", summary.Today)
	}
	if summary.Bank != 105000 {
		t.Fatalf("bank = %d, want 105000 (initial + reconciled only)", summary.Bank)
	}
	_ = past
}

func TestRegisterIncludesTags(t *testing.T) {
	s, _, wid, acc := newTestService(t)
	ctx := context.Background()
	_, _ = s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-15", Amount: -100, Tags: []string{"food", "cash"}})
	_, _ = s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-16", Amount: -200})

	rows, _, err := s.Register(ctx, acc)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if len(rows[0].Tags) != 2 {
		t.Fatalf("row 0 tags = %v, want 2", rows[0].Tags)
	}
	if len(rows[1].Tags) != 0 {
		t.Fatalf("row 1 tags = %v, want empty", rows[1].Tags)
	}
}

func TestBulkUpdate(t *testing.T) {
	s, q, wid, acc := newTestService(t)
	ctx := context.Background()
	cat, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})
	a, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-15", Amount: -100})
	b, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-16", Amount: -200})

	// Bulk set status across both → one transaction.
	n, err := s.BulkUpdate(ctx, wid, []int64{a.ID, b.ID}, BulkFieldStatus, iptr(StatusReconciled))
	if err != nil || n != 2 {
		t.Fatalf("bulk status: n=%d err=%v", n, err)
	}
	ga, _ := s.Get(ctx, a.ID)
	gb, _ := s.Get(ctx, b.ID)
	if ga.Status != StatusReconciled || gb.Status != StatusReconciled {
		t.Fatalf("statuses = %d/%d, want reconciled", ga.Status, gb.Status)
	}

	// Bulk set category.
	if _, err := s.BulkUpdate(ctx, wid, []int64{a.ID}, BulkFieldCategory, iptr(cat.ID)); err != nil {
		t.Fatalf("bulk category: %v", err)
	}
	if ga, _ = s.Get(ctx, a.ID); ga.CategoryID == nil || *ga.CategoryID != cat.ID {
		t.Fatalf("category not set: %+v", ga.CategoryID)
	}

	// Invalid field / value.
	if _, err := s.BulkUpdate(ctx, wid, []int64{a.ID}, "nope", nil); err != ErrInvalidBulkField {
		t.Fatalf("bad field = %v", err)
	}
	if _, err := s.BulkUpdate(ctx, wid, []int64{a.ID}, BulkFieldStatus, iptr(99)); err != ErrInvalidStatus {
		t.Fatalf("bad status = %v", err)
	}
}

func TestBulkUpdateAtomicAcrossWallets(t *testing.T) {
	s, q, wid, acc := newTestService(t)
	ctx := context.Background()
	mine, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-15", Amount: -100})

	// A transaction in a different wallet.
	w2, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	cur2, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w2.ID, IsoCode: "USD", Name: "USD", Symbol: "$",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc2, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w2.ID, Name: "X", Type: "bank", CurrencyID: cur2.ID, Position: 1})
	foreign, _ := s.Create(ctx, w2.ID, Input{AccountID: acc2.ID, Date: "2026-01-15", Amount: -100})

	// Bulk touching a foreign id must fail and roll back entirely.
	if _, err := s.BulkUpdate(ctx, wid, []int64{mine.ID, foreign.ID}, BulkFieldStatus, iptr(StatusReconciled)); err != ErrNotFound {
		t.Fatalf("cross-wallet bulk = %v, want ErrNotFound", err)
	}
	if got, _ := s.Get(ctx, mine.ID); got.Status != StatusNone {
		t.Fatalf("mine.status = %d, want unchanged (rollback)", got.Status)
	}
}

func TestSetStatus(t *testing.T) {
	s, _, wid, acc := newTestService(t)
	ctx := context.Background()
	tx, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-01-15", Amount: -100})
	if err := s.SetStatus(ctx, tx.ID, StatusReconciled); err != nil {
		t.Fatalf("SetStatus: %v", err)
	}
	got, _ := s.Get(ctx, tx.ID)
	if got.Status != StatusReconciled {
		t.Fatalf("status = %d, want reconciled", got.Status)
	}
	if err := s.SetStatus(ctx, tx.ID, 99); err != ErrInvalidStatus {
		t.Fatalf("invalid status = %v, want ErrInvalidStatus", err)
	}
}
