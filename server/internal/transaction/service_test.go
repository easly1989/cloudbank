package transaction

import (
	"context"
	"errors"
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

// Bank counts only reconciled rows dated on or before today: cleared-but-not-
// reconciled rows and future-dated reconciled rows are excluded, so Bank stays
// the confirmed subset of Today (Bank <= Today).
func TestRegisterBankExcludesClearedAndFuture(t *testing.T) {
	s, q, wid, _ := newTestService(t)
	ctx := context.Background()
	cur, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: wid, IsoCode: "USD", Name: "USD", Symbol: "$",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 0, Rate: 1,
	})
	if err != nil {
		t.Fatalf("InsertCurrency: %v", err)
	}
	acc, err := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: wid, Name: "Checking2", Type: "checking", CurrencyID: cur.ID,
		InitialBalance: 100000, Position: 2,
	})
	if err != nil {
		t.Fatalf("InsertAccount: %v", err)
	}
	for _, in := range []Input{
		{AccountID: acc.ID, Date: "2000-01-01", Amount: 5000, Status: StatusReconciled},
		{AccountID: acc.ID, Date: "2000-02-01", Amount: -2000, Status: StatusCleared},
		{AccountID: acc.ID, Date: "2099-12-31", Amount: 9000, Status: StatusReconciled},
	} {
		if _, err := s.Create(ctx, wid, in); err != nil {
			t.Fatalf("Create(%s): %v", in.Date, err)
		}
	}

	_, summary, err := s.Register(ctx, acc.ID)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	// Only the past reconciled row (+5000) counts toward Bank.
	if summary.Bank != 105000 {
		t.Fatalf("bank = %d, want 105000 (cleared and future-reconciled excluded)", summary.Bank)
	}
	// Today includes both past rows regardless of status (+5000 - 2000).
	if summary.Today != 103000 {
		t.Fatalf("today = %d, want 103000", summary.Today)
	}
	// Future includes every row (+5000 - 2000 + 9000).
	if summary.Future != 112000 {
		t.Fatalf("future = %d, want 112000", summary.Future)
	}
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

func TestSearchTransactions(t *testing.T) {
	s, q, wid, acc := newTestService(t)
	ctx := context.Background()

	payee, _ := q.InsertPayee(ctx, db.InsertPayeeParams{WalletID: wid, Name: "Amazon"})
	cat, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Groceries"})
	savings, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: wid, Name: "Savings", Type: "savings", CurrencyID: 1, Position: 2,
	})

	t1, _ := s.Create(ctx, wid, Input{
		AccountID: acc, Date: "2026-01-10", Amount: -5000, PayeeID: iptr(payee.ID),
		CategoryID: iptr(cat.ID), Memo: "Weekly shop", Tags: []string{"online"},
	})
	t2, _ := s.Create(ctx, wid, Input{
		AccountID: acc, Date: "2026-02-01", Amount: -100000, Info: "Rent payment", Status: StatusReconciled,
	})
	t3, _ := s.Create(ctx, wid, Input{
		AccountID: savings.ID, Date: "2026-01-20", Amount: -1500, Memo: "coffee beans",
	})

	ids := func(res SearchResult) map[int64]bool {
		m := map[int64]bool{}
		for _, r := range res.Rows {
			m[r.ID] = true
		}
		return m
	}
	search := func(sq SearchQuery) SearchResult {
		res, err := s.Search(ctx, wid, sq)
		if err != nil {
			t.Fatalf("Search(%+v): %v", sq, err)
		}
		return res
	}

	// Each searchable field matches (case-insensitively) as a substring.
	cases := []struct {
		q    string
		want int64
	}{
		{"amazon", t1.ID}, // payee name, lower-cased
		{"grocer", t1.ID}, // category name, substring
		{"shop", t1.ID},   // memo
		{"ONLINE", t1.ID}, // tag, upper-cased
		{"rent", t2.ID},   // info
		{"coffee", t3.ID}, // memo on the other account
	}
	for _, c := range cases {
		res := search(SearchQuery{Query: c.q})
		if len(res.Rows) != 1 || !ids(res)[c.want] {
			t.Fatalf("search %q → %d rows, want only txn %d (%+v)", c.q, len(res.Rows), c.want, res.Rows)
		}
	}

	// Account name is returned per row (results span accounts).
	if r := search(SearchQuery{Query: "coffee"}).Rows[0]; r.AccountName != "Savings" {
		t.Fatalf("coffee row accountName = %q, want Savings", r.AccountName)
	}

	// Account filter narrows to one account.
	if res := search(SearchQuery{Query: "coffee", AccountID: acc}); len(res.Rows) != 0 {
		t.Fatalf("coffee scoped to Checking → %d rows, want 0", len(res.Rows))
	}

	// Blank query returns nothing (not the whole ledger).
	if res := search(SearchQuery{Query: "   "}); len(res.Rows) != 0 {
		t.Fatalf("blank query → %d rows, want 0", len(res.Rows))
	}

	// Date and status filters combine with the text match.
	if res := search(SearchQuery{Query: "e", From: "2026-01-15"}); ids(res)[t1.ID] {
		t.Fatalf("from-date filter should exclude the Jan 10 txn")
	}
	if res := search(SearchQuery{Query: "e", Status: iptr(StatusReconciled)}); !ids(res)[t2.ID] || ids(res)[t1.ID] {
		t.Fatalf("status filter should keep only the reconciled txn: %+v", res.Rows)
	}
	// Amount filter (signed minor units).
	if res := search(SearchQuery{Query: "e", AmountMax: iptr(-50000)}); !ids(res)[t2.ID] || len(res.Rows) != 1 {
		t.Fatalf("amountMax filter should keep only the -100000 txn: %+v", res.Rows)
	}

	// Wallet scoping: an identical memo in another wallet must not leak.
	w2, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "W2"})
	cur2, _ := q.InsertCurrency(ctx, db.InsertCurrencyParams{
		WalletID: w2.ID, IsoCode: "USD", Name: "US Dollar", Symbol: "$",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	acc2, _ := q.InsertAccount(ctx, db.InsertAccountParams{
		WalletID: w2.ID, Name: "Other", Type: "checking", CurrencyID: cur2.ID, Position: 1,
	})
	_, _ = s.Create(ctx, w2.ID, Input{AccountID: acc2.ID, Date: "2026-01-10", Amount: -5000, Memo: "Weekly shop"})
	if res := search(SearchQuery{Query: "shop"}); len(res.Rows) != 1 || !ids(res)[t1.ID] {
		t.Fatalf("wallet scoping leaked: %+v", res.Rows)
	}
}

func TestSearchPaginationTotal(t *testing.T) {
	s, _, wid, acc := newTestService(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-03-01", Amount: -100, Memo: "subscription fee"}); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}
	res, err := s.Search(ctx, wid, SearchQuery{Query: "subscription", Limit: 2})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(res.Rows) != 2 {
		t.Fatalf("page size = %d, want 2", len(res.Rows))
	}
	if res.Total != 5 {
		t.Fatalf("total = %d, want 5", res.Total)
	}
	// Second page.
	res2, _ := s.Search(ctx, wid, SearchQuery{Query: "subscription", Limit: 2, Offset: 4})
	if len(res2.Rows) != 1 || res2.Total != 5 {
		t.Fatalf("offset page = %d rows / total %d, want 1 / 5", len(res2.Rows), res2.Total)
	}
}

func TestReviewAndDuplicates(t *testing.T) {
	s, q, wid, acc := newTestService(t)
	ctx := context.Background()

	// A bank-imported transaction with no category → needs a category.
	imported, err := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-04-10", Amount: -1000, ImportRef: "bank:1"})
	if err != nil {
		t.Fatalf("create imported: %v", err)
	}
	// A pair with the same account+amount a few days apart (d2 is the bank row).
	d1, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-05-01", Amount: -2500, Memo: "coffee"})
	d2, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-05-04", Amount: -2500, ImportRef: "bank:2"})

	rev, err := s.Review(ctx, wid)
	if err != nil {
		t.Fatalf("review: %v", err)
	}
	has := func(list []ReviewTxn, id int64) bool {
		for _, r := range list {
			if r.ID == id {
				return true
			}
		}
		return false
	}
	if !has(rev.NeedsCategory, imported.ID) || !has(rev.NeedsCategory, d2.ID) {
		t.Errorf("needsCategory missing an imported uncategorized row: %+v", rev.NeedsCategory)
	}
	if has(rev.NeedsCategory, d1.ID) {
		t.Errorf("manual d1 (no import ref) should not be in needsCategory")
	}
	if len(rev.Duplicates) != 1 {
		t.Fatalf("duplicates = %d, want 1", len(rev.Duplicates))
	}
	p := rev.Duplicates[0]
	matched := (p.A.ID == d1.ID && p.B.ID == d2.ID) || (p.A.ID == d2.ID && p.B.ID == d1.ID)
	if !matched {
		t.Fatalf("unexpected pair: %+v", p)
	}

	// Dismiss → the pair no longer surfaces.
	if err := s.DismissDuplicate(ctx, wid, d2.ID, d1.ID); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	rev2, _ := s.Review(ctx, wid)
	if len(rev2.Duplicates) != 0 {
		t.Fatalf("after dismiss, duplicates = %d, want 0", len(rev2.Duplicates))
	}

	// Merge a fresh pair: keep the manual row, carry the bank ref, drop the bank row.
	m1, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-06-01", Amount: -3000, Memo: "manual"})
	m2, _ := s.Create(ctx, wid, Input{AccountID: acc, Date: "2026-06-02", Amount: -3000, ImportRef: "bank:3"})
	if err := s.Merge(ctx, wid, m1.ID, m2.ID); err != nil {
		t.Fatalf("merge: %v", err)
	}
	if _, err := s.Get(ctx, m2.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("dropped transaction should be gone, err=%v", err)
	}
	row, err := q.GetTransaction(ctx, m1.ID)
	if err != nil {
		t.Fatalf("get kept: %v", err)
	}
	if row.Memo != "manual" {
		t.Errorf("kept memo = %q, want manual", row.Memo)
	}
	if row.ImportRef != "bank:3" {
		t.Errorf("kept import_ref = %q, want bank:3 (carried from the merged row)", row.ImportRef)
	}
}
