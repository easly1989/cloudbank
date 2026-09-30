package category

import (
	"context"
	"database/sql"
	"errors"
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

	food, err := s.Create(ctx, wid, "Food", nil, false, false, false)
	if err != nil {
		t.Fatalf("create top: %v", err)
	}
	// Subcategory inherits the parent's (expense) type even if told otherwise.
	groc, err := s.Create(ctx, wid, "Groceries", &food.ID, true, false, false)
	if err != nil {
		t.Fatalf("create sub: %v", err)
	}
	if groc.IsIncome {
		t.Fatal("subcategory did not inherit expense type")
	}
	// A subcategory cannot have children.
	if _, err := s.Create(ctx, wid, "Deeper", &groc.ID, false, false, false); err != ErrTooDeep {
		t.Fatalf("depth-3 create = %v, want ErrTooDeep", err)
	}
}

func TestMergeReassignsPayeeDefaultAndDeletes(t *testing.T) {
	s, q, wid := newTestService(t)
	ctx := context.Background()
	food, _ := s.Create(ctx, wid, "Food", nil, false, false, false)
	dining, _ := s.Create(ctx, wid, "Dining", nil, false, false, false)

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
	food, _ := s.Create(ctx, wid, "Food", nil, false, false, false)
	_, _ = s.Create(ctx, wid, "Groceries", &food.ID, false, false, false)
	other, _ := s.Create(ctx, wid, "Expenses", nil, false, false, false)

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
	food, _ := s.Create(ctx, wid, "Food", nil, false, false, false)
	dining, _ := s.Create(ctx, wid, "Dining", nil, false, false, false)

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
	food, _ := s.Create(ctx, wid, "Food", nil, false, false, false)
	_, _ = s.Create(ctx, wid, "Groceries", &food.ID, false, false, false)
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

// Category names are unique per level without regard to case (#531). The
// database index could not catch two top-level "Food"s at all: NULL parents
// never compare equal.
func TestDuplicateIgnoresCasePerLevel(t *testing.T) {
	s, _, wid := newTestService(t)
	ctx := context.Background()

	food, err := s.Create(ctx, wid, "Food", nil, false, false, false)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var dup *DuplicateError
	if _, err := s.Create(ctx, wid, "Food", nil, false, false, false); !errors.As(err, &dup) || dup.Existing != "Food" {
		t.Fatalf("second top-level Food = %v, want a DuplicateError", err)
	}
	if _, err := s.Create(ctx, wid, " food ", nil, false, false, false); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("case-different top-level = %v, want ErrDuplicate", err)
	}
	// The same name under a parent is another level: allowed.
	if _, err := s.Create(ctx, wid, "food", &food.ID, false, false, false); err != nil {
		t.Fatalf("food under Food: %v", err)
	}
	if _, err := s.Create(ctx, wid, "FOOD", &food.ID, false, false, false); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second food under Food = %v, want ErrDuplicate", err)
	}
	home, err := s.Create(ctx, wid, "Home", nil, false, false, false)
	if err != nil {
		t.Fatalf("create Home: %v", err)
	}
	if _, err := s.Update(ctx, home.ID, "FOOD", false, false, false, nil); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("rename Home to FOOD = %v, want ErrDuplicate", err)
	}
	if _, err := s.Update(ctx, food.ID, "food", false, false, false, nil); err != nil {
		t.Fatalf("recase own name: %v", err)
	}
}

func TestUpdateMovesBetweenLevels(t *testing.T) {
	s, q, wid := newTestService(t)
	ctx := context.Background()
	food, _ := s.Create(ctx, wid, "Food", nil, false, false, false)
	pay, _ := s.Create(ctx, wid, "Pay", nil, true, false, false)
	groc, _ := s.Create(ctx, wid, "Groceries", &food.ID, false, false, false)
	gifts, _ := s.Create(ctx, wid, "Gifts", nil, false, false, false)

	// No move: it stays under Food, whatever the edit.
	got, err := s.Update(ctx, groc.ID, "Groceries", true, true, false, nil)
	if err != nil || got.ParentID == nil || *got.ParentID != food.ID || got.IsIncome || !got.NoBudget {
		t.Fatalf("edit in place = %+v, %v", got, err)
	}
	// Under another group, it takes that group's type.
	got, err = s.Update(ctx, groc.ID, "Groceries", false, false, false, &Move{ParentID: &pay.ID})
	if err != nil || got.ParentID == nil || *got.ParentID != pay.ID || !got.IsIncome {
		t.Fatalf("move under Pay = %+v, %v", got, err)
	}
	// To the top level, it keeps the type it is given.
	got, err = s.Update(ctx, groc.ID, "Groceries", false, false, false, &Move{})
	if err != nil || got.ParentID != nil || got.IsIncome {
		t.Fatalf("move to the top = %+v, %v", got, err)
	}
	// A top-level category with no subcategories can go under another.
	got, err = s.Update(ctx, gifts.ID, "Gifts", false, false, false, &Move{ParentID: &food.ID})
	if err != nil || got.ParentID == nil || *got.ParentID != food.ID {
		t.Fatalf("move Gifts under Food = %+v, %v", got, err)
	}
	// One with subcategories cannot: they would be three levels deep.
	if _, err := s.Update(ctx, food.ID, "Food", false, false, false, &Move{ParentID: &pay.ID}); !errors.Is(err, ErrTooDeep) {
		t.Fatalf("move Food (with Gifts) under Pay = %v, want ErrTooDeep", err)
	}
	// Nor under a subcategory, nor under itself, nor under another wallet's.
	if _, err := s.Update(ctx, groc.ID, "Groceries", false, false, false, &Move{ParentID: &gifts.ID}); !errors.Is(err, ErrTooDeep) {
		t.Fatalf("move under a subcategory = %v, want ErrTooDeep", err)
	}
	if _, err := s.Update(ctx, groc.ID, "Groceries", false, false, false, &Move{ParentID: &groc.ID}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("move under itself = %v, want ErrBadTarget", err)
	}
	w2, err := q.CreateWallet(ctx, db.CreateWalletParams{Title: "Theirs"})
	if err != nil {
		t.Fatal(err)
	}
	foreign, _ := s.Create(ctx, w2.ID, "Theirs", nil, false, false, false)
	if _, err := s.Update(ctx, groc.ID, "Groceries", false, false, false, &Move{ParentID: &foreign.ID}); !errors.Is(err, ErrBadTarget) {
		t.Fatalf("move under another wallet's = %v, want ErrBadTarget", err)
	}
	// A name already used at the new level is refused, whatever its case.
	if _, err := s.Create(ctx, wid, "Groceries", &pay.ID, false, false, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, groc.ID, "groceries", false, false, false, &Move{ParentID: &pay.ID}); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("move beside a same-named one = %v, want ErrDuplicate", err)
	}
}
