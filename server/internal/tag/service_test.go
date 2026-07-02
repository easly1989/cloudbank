package tag

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
	"github.com/easly1989/cloudbank/server/internal/transaction"
)

// newFixture builds a wallet with one account, a transaction service (to seed
// tagged transactions, since tag creation happens on transaction save) and the
// tag service under test — all over the same store.
func newFixture(t *testing.T) (*transaction.Service, *Service, int64, int64) {
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
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	a, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "A", Type: "bank", CurrencyID: cur.ID, Position: 1})
	return transaction.NewService(st.Write()), NewService(st.Write()), w.ID, a.ID
}

func tagsList(t *testing.T, s *Service, wid int64) []Info {
	t.Helper()
	l, err := s.ListWithCounts(context.Background(), wid)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func tagID(t *testing.T, s *Service, wid int64, name string) int64 {
	t.Helper()
	for _, ti := range tagsList(t, s, wid) {
		if ti.Name == name {
			return ti.ID
		}
	}
	t.Fatalf("tag %q not found", name)
	return 0
}

func TestRenameMergeDelete(t *testing.T) {
	txns, s, wid, acc := newFixture(t)
	ctx := context.Background()
	// One txn tagged {food}, one tagged {food, dining}.
	if _, err := txns.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2026-01-01", Amount: -100, Tags: []string{"food"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := txns.Create(ctx, wid, transaction.Input{AccountID: acc, Date: "2026-01-02", Amount: -200, Tags: []string{"food", "dining"}}); err != nil {
		t.Fatal(err)
	}

	if l := tagsList(t, s, wid); len(l) != 2 {
		t.Fatalf("tags = %+v, want 2", l)
	}
	food := tagID(t, s, wid, "food")
	dining := tagID(t, s, wid, "dining")

	// Rename food → groceries (keeps its id).
	if err := s.Rename(ctx, wid, food, "groceries"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if tagID(t, s, wid, "groceries") != food {
		t.Fatal("rename changed the tag id")
	}
	// Renaming onto an existing name is rejected.
	if err := s.Rename(ctx, wid, dining, "groceries"); err != ErrDuplicate {
		t.Fatalf("rename-collision = %v, want ErrDuplicate", err)
	}

	// Merge dining → groceries; the txn that had both keeps only groceries.
	if err := s.Merge(ctx, wid, dining, food); err != nil {
		t.Fatalf("merge: %v", err)
	}
	after := tagsList(t, s, wid)
	if len(after) != 1 || after[0].Name != "groceries" || after[0].Count != 2 {
		t.Fatalf("after merge = %+v, want one 'groceries' count 2", after)
	}

	// Delete removes the tag and untags every transaction.
	if err := s.Delete(ctx, wid, food); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if l := tagsList(t, s, wid); len(l) != 0 {
		t.Fatalf("after delete = %+v, want none", l)
	}
}
