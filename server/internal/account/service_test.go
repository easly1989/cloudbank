package account

import (
	"context"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newTestService(t *testing.T) (*Service, int64, int64) {
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
	return NewService(st.Write()), w.ID, cur.ID
}

func TestCreateAssignsPositionAndCurrency(t *testing.T) {
	s, wid, cid := newTestService(t)
	ctx := context.Background()

	a1, err := s.Create(ctx, wid, Input{Name: "A", Type: "bank", CurrencyID: cid, InitialBalance: 1000})
	if err != nil {
		t.Fatalf("create a1: %v", err)
	}
	a2, err := s.Create(ctx, wid, Input{Name: "B", Type: "cash", CurrencyID: cid})
	if err != nil {
		t.Fatalf("create a2: %v", err)
	}
	if a1.Position >= a2.Position {
		t.Fatalf("positions not increasing: %d then %d", a1.Position, a2.Position)
	}
	if a1.Balance != 1000 || a1.CurrencyCode != "EUR" {
		t.Fatalf("a1 = %+v", a1)
	}
}

func TestCreateRejectsForeignCurrency(t *testing.T) {
	s, wid, _ := newTestService(t)
	if _, err := s.Create(context.Background(), wid, Input{Name: "A", Type: "bank", CurrencyID: 9999}); err != ErrCurrencyNotInWallet {
		t.Fatalf("foreign currency = %v, want ErrCurrencyNotInWallet", err)
	}
}

func TestReorder(t *testing.T) {
	s, wid, cid := newTestService(t)
	ctx := context.Background()
	a1, _ := s.Create(ctx, wid, Input{Name: "A", Type: "bank", CurrencyID: cid})
	a2, _ := s.Create(ctx, wid, Input{Name: "B", Type: "bank", CurrencyID: cid})

	// Swap their order and put a2 in a group.
	if err := s.Reorder(ctx, []PositionUpdate{
		{ID: a2.ID, Position: 1, GroupName: "Savings"},
		{ID: a1.ID, Position: 2, GroupName: ""},
	}); err != nil {
		t.Fatalf("Reorder: %v", err)
	}
	list, _ := s.List(ctx, wid)
	if len(list) != 2 || list[0].ID != a2.ID || list[0].GroupName != "Savings" {
		t.Fatalf("after reorder = %+v", list)
	}
}

func TestValidType(t *testing.T) {
	for _, ty := range Types {
		if !ValidType(ty) {
			t.Errorf("%q should be valid", ty)
		}
	}
	if ValidType("nope") {
		t.Error("invalid type accepted")
	}
}
