package currency

import (
	"context"
	"math"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store"
	"github.com/easly1989/cloudbank/server/internal/store/db"
)

func newTestService(t *testing.T) (*Service, *db.Queries) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return NewService(st.Write()), db.New(st.Write())
}

func seedWallet(t *testing.T, q *db.Queries) int64 {
	t.Helper()
	w, err := q.CreateWallet(context.Background(), db.CreateWalletParams{Title: "W", OwnerName: ""})
	if err != nil {
		t.Fatalf("seed wallet: %v", err)
	}
	return w.ID
}

func TestAddFirstCurrencyBecomesBase(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)

	c, err := s.AddCurrency(ctx, wid, "usd", false)
	if err != nil {
		t.Fatalf("AddCurrency: %v", err)
	}
	if !c.IsBase || c.IsoCode != "USD" || c.Rate != 1 {
		t.Fatalf("first currency = %+v, want base USD rate 1", c)
	}
	// wallet.base_currency_id points at it.
	w, _ := q.GetWallet(ctx, wid)
	if !w.BaseCurrencyID.Valid || w.BaseCurrencyID.Int64 != c.ID {
		t.Fatalf("wallet base_currency_id = %+v, want %d", w.BaseCurrencyID, c.ID)
	}
}

func TestAddDuplicateRejected(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	if _, err := s.AddCurrency(ctx, wid, "USD", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddCurrency(ctx, wid, "USD", false); err != ErrDuplicate {
		t.Fatalf("duplicate add = %v, want ErrDuplicate", err)
	}
}

func TestAddUnknownCodeRejected(t *testing.T) {
	s, q := newTestService(t)
	wid := seedWallet(t, q)
	if _, err := s.AddCurrency(context.Background(), wid, "ZZZ", false); err != ErrUnknownCode {
		t.Fatalf("unknown code = %v, want ErrUnknownCode", err)
	}
}

func TestSetBaseSwitchesBase(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	usd, _ := s.AddCurrency(ctx, wid, "USD", false) // base
	eur, _ := s.AddCurrency(ctx, wid, "EUR", false) // secondary

	if err := s.SetBase(ctx, wid, eur.ID); err != nil {
		t.Fatalf("SetBase: %v", err)
	}
	list, _ := s.ListForWallet(ctx, wid)
	for _, c := range list {
		switch c.ID {
		case eur.ID:
			if !c.IsBase {
				t.Error("EUR should be base")
			}
		case usd.ID:
			if c.IsBase {
				t.Error("USD should no longer be base")
			}
		}
	}
	w, _ := q.GetWallet(ctx, wid)
	if w.BaseCurrencyID.Int64 != eur.ID {
		t.Fatalf("wallet base = %d, want %d", w.BaseCurrencyID.Int64, eur.ID)
	}
}

func TestUpdateRateRecordsHistoryAndRejectsBase(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	usd, _ := s.AddCurrency(ctx, wid, "USD", false) // base
	eur, _ := s.AddCurrency(ctx, wid, "EUR", false)

	if err := s.UpdateRate(ctx, eur.ID, 1.08); err != nil {
		t.Fatalf("UpdateRate: %v", err)
	}
	got, _ := s.Get(ctx, eur.ID)
	if got.Rate != 1.08 {
		t.Fatalf("rate = %v, want 1.08", got.Rate)
	}
	hist, _ := s.RateHistory(ctx, eur.ID)
	if len(hist) != 1 || hist[0].Rate != 1.08 || hist[0].Source != "manual" {
		t.Fatalf("history = %+v", hist)
	}
	// The base currency's rate cannot be changed.
	if err := s.UpdateRate(ctx, usd.ID, 2); err != ErrBaseCurrency {
		t.Fatalf("update base rate = %v, want ErrBaseCurrency", err)
	}
}

func TestDeleteBaseRejected(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	usd, _ := s.AddCurrency(ctx, wid, "USD", false)
	eur, _ := s.AddCurrency(ctx, wid, "EUR", false)

	if err := s.Delete(ctx, usd.ID); err != ErrBaseCurrency {
		t.Fatalf("delete base = %v, want ErrBaseCurrency", err)
	}
	if err := s.Delete(ctx, eur.ID); err != nil {
		t.Fatalf("delete non-base: %v", err)
	}
}

func TestCatalogLoaded(t *testing.T) {
	if len(Catalog()) < 10 {
		t.Fatal("catalog should contain many currencies")
	}
	if _, ok := Lookup("eur"); !ok {
		t.Fatal("EUR should be in the catalog (case-insensitive)")
	}
	if _, ok := Lookup("ZZZ"); ok {
		t.Fatal("ZZZ should not be in the catalog")
	}
}

func TestSetBaseReworksRates(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	eur, _ := s.AddCurrency(ctx, wid, "EUR", false) // base
	usd, _ := s.AddCurrency(ctx, wid, "USD", false)
	gbp, _ := s.AddCurrency(ctx, wid, "GBP", false)
	// 1 $ = 0.8 €, 1 £ = 1.2 €.
	if err := s.UpdateRate(ctx, usd.ID, 0.8); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateRate(ctx, gbp.ID, 1.2); err != nil {
		t.Fatal(err)
	}

	if err := s.SetBase(ctx, wid, usd.ID); err != nil {
		t.Fatalf("SetBase: %v", err)
	}
	// Against the dollar: 1 € = 1.25 $, 1 £ = 1.5 $.
	want := map[int64]float64{usd.ID: 1, eur.ID: 1.25, gbp.ID: 1.5}
	list, _ := s.ListForWallet(ctx, wid)
	for _, c := range list {
		if math.Abs(c.Rate-want[c.ID]) > 1e-9 {
			t.Errorf("%s rate = %v, want %v", c.IsoCode, c.Rate, want[c.ID])
		}
	}
	// The old base now has a rate, recorded as where the dollar's came from.
	for _, c := range list {
		if c.ID == eur.ID && c.RateSource != "manual" {
			t.Errorf("EUR source = %q, want manual", c.RateSource)
		}
	}
}

func TestDeleteInUseRejected(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	_, _ = s.AddCurrency(ctx, wid, "EUR", false)
	usd, _ := s.AddCurrency(ctx, wid, "USD", false)
	if _, err := q.InsertAccount(ctx, db.InsertAccountParams{WalletID: wid, Name: "Card", Type: "creditcard", CurrencyID: usd.ID}); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.AccountCount(ctx, usd.ID); n != 1 {
		t.Fatalf("AccountCount = %d, want 1", n)
	}
	if err := s.Delete(ctx, usd.ID); err != ErrInUse {
		t.Fatalf("delete in use = %v, want ErrInUse", err)
	}
}

func TestUpdateFormatChecks(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	_, _ = s.AddCurrency(ctx, wid, "EUR", false)
	usd, _ := s.AddCurrency(ctx, wid, "USD", false)
	if err := s.UpdateFormat(ctx, usd.ID, "US$", true, ",", ".", 2); err != nil {
		t.Fatalf("valid format: %v", err)
	}
	for _, bad := range []struct {
		dec, grp string
		frac     int
	}{{"", ",", 2}, {".", ".", 2}, {".", ",,", 2}, {".", ",", 9}, {".", ",", -1}} {
		if err := s.UpdateFormat(ctx, usd.ID, "$", true, bad.dec, bad.grp, bad.frac); err != ErrInvalidFormat {
			t.Errorf("format %+v = %v, want ErrInvalidFormat", bad, err)
		}
	}
}

func TestListCarriesLatestRate(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedWallet(t, q)
	_, _ = s.AddCurrency(ctx, wid, "EUR", false)
	usd, _ := s.AddCurrency(ctx, wid, "USD", false)
	if err := q.UpsertExchangeRate(ctx, db.UpsertExchangeRateParams{CurrencyID: usd.ID, Date: "2026-01-01", Rate: 0.9, Source: "frankfurter"}); err != nil {
		t.Fatal(err)
	}
	if err := q.UpsertExchangeRate(ctx, db.UpsertExchangeRateParams{CurrencyID: usd.ID, Date: "2026-02-01", Rate: 0.8, Source: "manual"}); err != nil {
		t.Fatal(err)
	}
	list, _ := s.ListForWallet(ctx, wid)
	for _, c := range list {
		switch c.ID {
		case usd.ID:
			if c.RateDate != "2026-02-01" || c.RateSource != "manual" {
				t.Errorf("USD latest = %q %q, want 2026-02-01 manual", c.RateDate, c.RateSource)
			}
		default:
			if c.RateDate != "" || c.RateSource != "" {
				t.Errorf("EUR latest = %q %q, want none", c.RateDate, c.RateSource)
			}
		}
	}
}
