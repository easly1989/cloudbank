package template

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
	"github.com/easly1989/cloudbank/server/internal/transfer"
)

func iptr(v int64) *int64 { return &v }

func newFixture(t *testing.T) (*Service, *transaction.Service, *transfer.Service, *db.Queries, int64, int64, int64) {
	t.Helper()
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
		DecimalChar: ",", GroupChar: ".", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	a, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "checking", CurrencyID: cur.ID, Position: 1})
	b, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "B", Type: "savings", CurrencyID: cur.ID, Position: 2})
	return NewService(st.Write()), transaction.NewService(st.Write()), transfer.NewService(st.Write()), q, w.ID, a.ID, b.ID
}

func TestTemplateCRUDWithSplits(t *testing.T) {
	s, _, _, q, wid, acc, _ := newFixture(t)
	ctx := context.Background()
	cat, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "Food"})

	tpl, err := s.Create(ctx, wid, Input{
		Name: "Groceries", AccountID: &acc, Amount: -10000, PaymentMode: 3, Memo: "weekly",
		Tags: []string{"food", "food"},
		Splits: []Split{
			{CategoryID: iptr(cat.ID), Amount: -6000, Memo: "veg"},
			{CategoryID: iptr(cat.ID), Amount: -4000},
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if !tpl.IsSplit || len(tpl.Splits) != 2 || len(tpl.Tags) != 1 {
		t.Fatalf("template = %+v", tpl)
	}

	// Update replaces splits.
	upd, err := s.Update(ctx, wid, tpl.ID, Input{Name: "Groceries", AccountID: &acc, Amount: -5000})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if upd.IsSplit || len(upd.Splits) != 0 || upd.Amount != -5000 {
		t.Fatalf("updated = %+v", upd)
	}

	list, _ := s.List(ctx, wid)
	if len(list) != 1 {
		t.Fatalf("list = %d, want 1", len(list))
	}
	if err := s.Delete(ctx, tpl.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if list, _ = s.List(ctx, wid); len(list) != 0 {
		t.Fatalf("after delete list = %d", len(list))
	}
}

func TestTemplateValidation(t *testing.T) {
	s, _, _, _, wid, acc, _ := newFixture(t)
	ctx := context.Background()
	if _, err := s.Create(ctx, wid, Input{Name: "  ", AccountID: &acc}); err != ErrNameRequired {
		t.Fatalf("blank name = %v", err)
	}
	if _, err := s.Create(ctx, wid, Input{Name: "X", AccountID: iptr(9999)}); err != ErrInvalidAccount {
		t.Fatalf("foreign account = %v", err)
	}
}

func TestCreateFromTransactionWithSplitsAndTags(t *testing.T) {
	s, ts, _, q, wid, acc, _ := newFixture(t)
	ctx := context.Background()
	a, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "A"})
	b, _ := q.InsertCategory(ctx, db.InsertCategoryParams{WalletID: wid, Name: "B"})
	txn, _ := ts.Create(ctx, wid, transaction.Input{
		AccountID: acc, Date: "2026-01-15", Amount: -10000, PaymentMode: 3, Memo: "shop",
		Tags: []string{"x"},
		Splits: []transaction.Split{
			{CategoryID: iptr(a.ID), Amount: -6000},
			{CategoryID: iptr(b.ID), Amount: -4000},
		},
	})

	tpl, err := s.CreateFromTransaction(ctx, wid, txn.ID, "Shop")
	if err != nil {
		t.Fatalf("CreateFromTransaction: %v", err)
	}
	if tpl.Name != "Shop" || tpl.Amount != -10000 || tpl.PaymentMode != 3 {
		t.Fatalf("template = %+v", tpl)
	}
	if !tpl.IsSplit || len(tpl.Splits) != 2 {
		t.Fatalf("splits = %+v", tpl.Splits)
	}
	if len(tpl.Tags) != 1 || tpl.Tags[0] != "x" {
		t.Fatalf("tags = %v", tpl.Tags)
	}
}

func TestCreateFromTransferLeg(t *testing.T) {
	s, _, xs, _, wid, accA, accB := newFixture(t)
	ctx := context.Background()
	tr, _ := xs.Create(ctx, wid, transfer.Input{FromAccountID: accA, ToAccountID: accB, Date: "2026-01-15", FromAmount: 5000})

	// Build a template from the *to* leg; it must still capture the transfer
	// direction A → B with the source amount.
	tpl, err := s.CreateFromTransaction(ctx, wid, tr.TxnToID, "Move to savings")
	if err != nil {
		t.Fatalf("CreateFromTransaction: %v", err)
	}
	if !tpl.IsTransfer || tpl.AccountID == nil || *tpl.AccountID != accA || tpl.ToAccountID == nil || *tpl.ToAccountID != accB {
		t.Fatalf("transfer template = %+v", tpl)
	}
	if tpl.Amount != -5000 {
		t.Fatalf("amount = %d, want -5000 (source leg)", tpl.Amount)
	}
}

func TestCreateFromTransactionCrossWallet(t *testing.T) {
	s, ts, _, q, wid, acc, _ := newFixture(t)
	ctx := context.Background()
	txn, _ := ts.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2026-01-15", Amount: -100})

	other, _ := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Other"})
	if _, err := s.CreateFromTransaction(ctx, other.ID, txn.ID, "X"); err != ErrNotFound {
		t.Fatalf("cross-wallet = %v, want ErrNotFound", err)
	}
}
