package category

import (
	"context"
	"database/sql"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newTestService(t *testing.T) (*Service, *db.Queries, int64) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	q := db.New(st.Write())
	w, err := q.CreateWallet(context.Background(), db.CreateWalletParams{Title: "W"})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(st.Write()), q, w.ID
}

func TestCreateInheritsTypeAndEnforcesDepth(t *testing.T) {
	s, _, wid := newTestService(t)
	ctx := context.Background()

	food, err := s.Create(ctx, wid, "Food", nil, false, false)
	if err != nil {
		t.Fatalf("create top: %v", err)
	}
	// Subcategory inherits the parent's (expense) type even if told otherwise.
	groc, err := s.Create(ctx, wid, "Groceries", &food.ID, true, false)
	if err != nil {
		t.Fatalf("create sub: %v", err)
	}
	if groc.IsIncome {
		t.Fatal("subcategory did not inherit expense type")
	}
	// A subcategory cannot have children.
	if _, err := s.Create(ctx, wid, "Deeper", &groc.ID, false, false); err != ErrTooDeep {
		t.Fatalf("depth-3 create = %v, want ErrTooDeep", err)
	}
}

func TestMergeReassignsPayeeDefaultAndDeletes(t *testing.T) {
	s, q, wid := newTestService(t)
	ctx := context.Background()
	food, _ := s.Create(ctx, wid, "Food", nil, false, false)
	dining, _ := s.Create(ctx, wid, "Dining", nil, false, false)

	// A payee defaults to Food.
	p, err := q.InsertPayee(ctx, db.InsertPayeeParams{
		WalletID: wid, Name: "Restaurant", DefaultCategoryID: sql.NullInt64{Int64: food.ID, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := s.Merge(ctx, wid, food.ID, dining.ID); err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if _, err := s.Get(ctx, food.ID); err != ErrNotFound {
		t.Fatalf("source still exists: %v", err)
	}
	got, _ := q.GetPayee(ctx, p.ID)
	if !got.DefaultCategoryID.Valid || got.DefaultCategoryID.Int64 != dining.ID {
		t.Fatalf("payee default not reassigned: %+v", got.DefaultCategoryID)
	}
}

func TestDeleteWithChildren(t *testing.T) {
	s, _, wid := newTestService(t)
	ctx := context.Background()
	food, _ := s.Create(ctx, wid, "Food", nil, false, false)
	_, _ = s.Create(ctx, wid, "Groceries", &food.ID, false, false)
	other, _ := s.Create(ctx, wid, "Expenses", nil, false, false)

	// Deleting a parent without a reassign target is refused.
	if err := s.Delete(ctx, wid, food.ID, nil); err != ErrHasChildren {
		t.Fatalf("delete parent w/o target = %v, want ErrHasChildren", err)
	}
	// With a top-level target, children are reparented and the parent removed.
	if err := s.Delete(ctx, wid, food.ID, &other.ID); err != nil {
		t.Fatalf("delete with reassign: %v", err)
	}
	if _, err := s.Get(ctx, food.ID); err != ErrNotFound {
		t.Fatal("parent not deleted")
	}
	cats, _ := s.List(ctx, wid)
	for _, c := range cats {
		if c.Name == "Groceries" && (c.ParentID == nil || *c.ParentID != other.ID) {
			t.Fatalf("child not reparented to target: %+v", c)
		}
	}
}

func TestMergeReassignsTransactions(t *testing.T) {
	s, q, wid := newTestService(t)
	ctx := context.Background()
	food, _ := s.Create(ctx, wid, "Food", nil, false, false)
	dining, _ := s.Create(ctx, wid, "Dining", nil, false, false)

	cur, err := q.InsertCurrency(ctx, db.InsertCurrencyParams{WalletID: wid, IsoCode: "EUR", Name: "Euro", DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 1, Rate: 1})
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: wid, Name: "A", Type: "bank", CurrencyID: cur.ID, Position: 1})
	if err != nil {
		t.Fatal(err)
	}
	txn, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
		WalletID: wid, AccountID: acc.ID, Date: "2026-01-01", Amount: -100,
		CategoryID: sql.NullInt64{Int64: food.ID, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := s.Merge(ctx, wid, food.ID, dining.ID); err != nil {
		t.Fatalf("Merge: %v", err)
	}
	got, _ := q.GetTransaction(ctx, txn.ID)
	if !got.CategoryID.Valid || got.CategoryID.Int64 != dining.ID {
		t.Fatalf("transaction category not reassigned: %+v", got.CategoryID)
	}
}

func TestUsage(t *testing.T) {
	s, q, wid := newTestService(t)
	ctx := context.Background()
	food, _ := s.Create(ctx, wid, "Food", nil, false, false)
	_, _ = s.Create(ctx, wid, "Groceries", &food.ID, false, false)
	_, _ = q.InsertPayee(ctx, db.InsertPayeeParams{
		WalletID: wid, Name: "Shop", DefaultCategoryID: sql.NullInt64{Int64: food.ID, Valid: true},
	})

	u, err := s.Usage(ctx, food.ID)
	if err != nil {
		t.Fatal(err)
	}
	if u.Subcategories != 1 || u.Payees != 1 {
		t.Fatalf("usage = %+v, want {1,1}", u)
	}
}
