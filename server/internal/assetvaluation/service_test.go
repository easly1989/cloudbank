package assetvaluation

import (
	"context"
	"errors"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newFixture(t *testing.T) (*Service, int64, int64, int64) {
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
		WalletID: w.ID, IsoCode: "EUR", Name: "Euro", Symbol: "E",
		DecimalChar: ".", GroupChar: ",", FracDigits: 2, IsBase: 1, Rate: 1,
	})
	asset, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "House", Type: "asset", CurrencyID: cur.ID})
	bank, _ := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: w.ID, Name: "Checking", Type: "bank", CurrencyID: cur.ID})
	return NewService(st.Write()), w.ID, asset.ID, bank.ID
}

func TestValuationCRUD(t *testing.T) {
	s, wid, asset, bank := newFixture(t)
	ctx := context.Background()

	// Only asset accounts accept valuations.
	if _, err := s.Add(ctx, wid, bank, Input{Date: "2026-01-01", Value: 1000}); !errors.Is(err, ErrNotAsset) {
		t.Fatalf("valuation on bank account = %v, want ErrNotAsset", err)
	}
	// An unknown / cross-wallet account.
	if _, err := s.Add(ctx, wid, 9999, Input{Date: "2026-01-01", Value: 1000}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown account = %v, want ErrNotFound", err)
	}
	// Validation.
	if _, err := s.Add(ctx, wid, asset, Input{Date: "", Value: 1000}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty date = %v, want ErrInvalid", err)
	}
	if _, err := s.Add(ctx, wid, asset, Input{Date: "2026-01-01", Value: -1}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("negative value = %v, want ErrInvalid", err)
	}

	// Add two valuations; List is newest-first by date.
	v1, err := s.Add(ctx, wid, asset, Input{Date: "2026-01-01", Value: 300000, Note: "buy"})
	if err != nil {
		t.Fatalf("add1: %v", err)
	}
	if _, err := s.Add(ctx, wid, asset, Input{Date: "2026-06-01", Value: 320000}); err != nil {
		t.Fatalf("add2: %v", err)
	}
	list, err := s.List(ctx, wid, asset)
	if err != nil || len(list) != 2 {
		t.Fatalf("list = %+v, %v; want 2", list, err)
	}
	if list[0].Date != "2026-06-01" || list[1].Date != "2026-01-01" {
		t.Fatalf("list order = %s, %s; want newest first", list[0].Date, list[1].Date)
	}

	// Update the first valuation.
	u, err := s.Update(ctx, wid, v1.ID, Input{Date: "2026-01-02", Value: 305000, Note: "adj"})
	if err != nil || u.Value != 305000 || u.Date != "2026-01-02" {
		t.Fatalf("update = %+v, %v", u, err)
	}

	// Delete it, then deleting again is not-found.
	if err := s.Delete(ctx, wid, v1.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if after, _ := s.List(ctx, wid, asset); len(after) != 1 {
		t.Fatalf("after delete len = %d, want 1", len(after))
	}
	if err := s.Delete(ctx, wid, v1.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing = %v, want ErrNotFound", err)
	}
}
