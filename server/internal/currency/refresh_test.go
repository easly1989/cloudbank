package currency

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/easly1989/cloudbank/server/internal/store/db"
)

// fakeProvider returns canned rates and counts how often it is called.
type fakeProvider struct {
	rates map[string]float64
	date  string
	err   error
	calls int
}

func (f *fakeProvider) Latest(_ context.Context, base string) (map[string]float64, string, error) {
	f.calls++
	if f.err != nil {
		return nil, "", f.err
	}
	if base != "EUR" {
		return nil, "", errors.New("unsupported base")
	}
	return f.rates, f.date, nil
}

// seedEURWallet creates a wallet with EUR (base) plus the given extra currencies.
func seedEURWallet(t *testing.T, s *Service, q *db.Queries, extra ...string) int64 {
	t.Helper()
	ctx := context.Background()
	wid := seedWallet(t, q)
	if _, err := s.AddCurrency(ctx, wid, "EUR", true); err != nil {
		t.Fatalf("add EUR: %v", err)
	}
	for _, code := range extra {
		if _, err := s.AddCurrency(ctx, wid, code, false); err != nil {
			t.Fatalf("add %s: %v", code, err)
		}
	}
	return wid
}

func TestRefreshRatesUpdatesAndInverts(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedEURWallet(t, s, q, "USD", "JPY")
	// Provider gives units per 1 EUR; JPY is omitted (not covered by ECB here).
	prov := &fakeProvider{rates: map[string]float64{"USD": 1.10}, date: "2026-06-18"}

	res, err := s.RefreshRates(ctx, wid, prov)
	if err != nil {
		t.Fatalf("RefreshRates: %v", err)
	}
	if len(res.Updated) != 1 || res.Updated[0] != "USD" {
		t.Fatalf("updated = %v, want [USD]", res.Updated)
	}
	if len(res.Unsupported) != 1 || res.Unsupported[0] != "JPY" {
		t.Fatalf("unsupported = %v, want [JPY]", res.Unsupported)
	}
	if res.ProviderError != "" || res.Date != "2026-06-18" {
		t.Fatalf("res = %+v", res)
	}

	cur, _ := s.ListForWallet(ctx, wid)
	var usd, jpy Currency
	for _, c := range cur {
		switch c.IsoCode {
		case "USD":
			usd = c
		case "JPY":
			jpy = c
		}
	}
	// USD stored rate is base-per-unit = 1/1.10.
	if math.Abs(usd.Rate-1.0/1.10) > 1e-9 {
		t.Fatalf("USD rate = %v, want %v", usd.Rate, 1.0/1.10)
	}
	// JPY keeps its manual rate (default 1) and is not stamped from the provider.
	if jpy.Rate != 1 {
		t.Fatalf("JPY rate = %v, want 1 (untouched)", jpy.Rate)
	}

	hist, _ := s.RateHistory(ctx, usd.ID)
	if len(hist) == 0 || hist[0].Source != "frankfurter" {
		t.Fatalf("USD history = %+v", hist)
	}
}

func TestRefreshRatesProviderDownIsGraceful(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	wid := seedEURWallet(t, s, q, "USD")
	prov := &fakeProvider{err: errors.New("network down")}

	res, err := s.RefreshRates(ctx, wid, prov)
	if err != nil {
		t.Fatalf("RefreshRates should not error on provider failure: %v", err)
	}
	if res.ProviderError == "" || len(res.Updated) != 0 {
		t.Fatalf("expected graceful degradation, got %+v", res)
	}
	cur, _ := s.ListForWallet(ctx, wid)
	for _, c := range cur {
		if c.IsoCode == "USD" && c.Rate != 1 {
			t.Fatalf("USD rate changed despite provider failure: %v", c.Rate)
		}
	}
}

func TestRefreshRatesNilProvider(t *testing.T) {
	s, q := newTestService(t)
	wid := seedEURWallet(t, s, q, "USD")
	res, err := s.RefreshRates(context.Background(), wid, nil)
	if err != nil || res.ProviderError == "" {
		t.Fatalf("nil provider should degrade gracefully, got res=%+v err=%v", res, err)
	}
}

func TestRefreshAllCachesPerBase(t *testing.T) {
	s, q := newTestService(t)
	ctx := context.Background()
	// Two EUR-based wallets sharing a base currency.
	seedEURWallet(t, s, q, "USD")
	seedEURWallet(t, s, q, "USD")

	prov := &fakeProvider{rates: map[string]float64{"USD": 1.10}, date: "2026-06-18"}
	if err := s.RefreshAll(ctx, prov, nil); err != nil {
		t.Fatalf("RefreshAll: %v", err)
	}
	// Two wallets, but the memoising wrapper makes a single upstream call.
	if prov.calls != 1 {
		t.Fatalf("provider calls = %d, want 1 (cached per base)", prov.calls)
	}
}
