package account

import (
	"context"
	"testing"
	"time"

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

func TestDefaultPaymentModeRoundTrips(t *testing.T) {
	s, wid, cid := newTestService(t)
	ctx := context.Background()

	// Create carries the default payment mode through to Get/List.
	a, err := s.Create(ctx, wid, Input{Name: "Card", Type: "creditcard", CurrencyID: cid, DefaultPaymentMode: 3})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if a.DefaultPaymentMode != 3 {
		t.Fatalf("created default paymode = %d, want 3", a.DefaultPaymentMode)
	}
	list, err := s.List(ctx, wid)
	if err != nil || len(list) != 1 || list[0].DefaultPaymentMode != 3 {
		t.Fatalf("list = %+v, err %v", list, err)
	}

	// Update changes it; unset means the default 0 (None).
	up, err := s.Update(ctx, wid, a.ID, Input{Name: "Card", Type: "creditcard", CurrencyID: cid, DefaultPaymentMode: 5})
	if err != nil || up.DefaultPaymentMode != 5 {
		t.Fatalf("update = %+v, err %v", up, err)
	}
	def, err := s.Create(ctx, wid, Input{Name: "Plain", Type: "bank", CurrencyID: cid})
	if err != nil || def.DefaultPaymentMode != 0 {
		t.Fatalf("default = %+v, err %v", def, err)
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

func TestBalancesReflectTransactions(t *testing.T) {
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
	s := NewService(st.Write())
	a, err := s.Create(ctx, w.ID, Input{Name: "A", Type: "bank", CurrencyID: cur.ID, InitialBalance: 1000})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	now := time.Now().UTC()
	ins := func(date string, amount int64) {
		if _, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
			WalletID: w.ID, AccountID: a.ID, Date: date, Amount: amount,
		}); err != nil {
			t.Fatalf("insert txn: %v", err)
		}
	}
	ins(now.AddDate(0, 0, -1).Format(dateLayout), 5000) // past
	ins(now.Format(dateLayout), -2000)                  // today
	ins(now.AddDate(0, 0, 1).Format(dateLayout), -1000) // future

	// today = initial + past + today = 1000 + 5000 - 2000 = 4000
	// future = today + future-dated = 4000 - 1000 = 3000
	got, err := s.Get(ctx, a.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Balance != 4000 || got.FutureBalance != 3000 {
		t.Fatalf("Get balances: today=%d future=%d (want 4000/3000)", got.Balance, got.FutureBalance)
	}
	list, err := s.List(ctx, w.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].Balance != 4000 || list[0].FutureBalance != 3000 {
		t.Fatalf("List balances = %+v", list)
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
